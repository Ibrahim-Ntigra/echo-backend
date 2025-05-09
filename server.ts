import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { createMachine, assign, fromPromise, createActor } from 'xstate';

const app = express();
const port = 3001;

const server = app.listen(port, () => {
  console.log(`Backend running on port ${port}`);
});

const wss = new WebSocketServer({ server });

interface WorkflowContext {
  retries: number;
  results: number[];
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  
  const send = (type: string, payload: any = {}) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...payload }));
    }
  };

  const workflowMachine = createMachine({
    id: 'workflow',
    initial: 'first',
    context: {
      retries: 0,
      results: [] as number[]
    },
    states: {
      first: {
        invoke: {
          src: fromPromise(({ input }) => generateNumberAndCheck(input.min, input.max, input.index)),
          input: ({ context }) => ({ min: 0, max: 25, index: 0, retries: context.retries }),
          onDone: { 
            target: 'second', 
            actions: [
              assign({
                results: ({ context, event }) => [...context.results, event.output]
              }),
              ({ context }) => send('RETRY_UPDATE', { count: context.retries })
            ]
          },
          onError: { 
            target: 'retry',
            actions: assign({
              retries: ({ context }) => context.retries + 1
            })
          }
        }
      },
      second: {
        invoke: {
          src: fromPromise(({ input }) => generateNumberAndCheck(input.min, input.max, input.index)),
          input: ({ context }) => ({ min: 25, max: 50, index: 1, retries: context.retries }),
          onDone: { 
            target: 'third', 
            actions: [
              assign({
                results: ({ context, event }) => [...context.results, event.output]
              }),
              ({ context }) => send('RETRY_UPDATE', { count: context.retries })
            ]
          },
          onError: { 
            target: 'retry',
            actions: assign({
              retries: ({ context }) => context.retries + 1
            })
          }
        }
      },
      third: {
        invoke: {
          src: fromPromise(({ input }) => generateNumberAndCheck(input.min, input.max, input.index)),
          input: ({ context }) => ({ min: 50, max: 75, index: 2, retries: context.retries }),
          onDone: { 
            target: 'fourth', 
            actions: [
              assign({
                results: ({ context, event }) => [...context.results, event.output]
              }),
              ({ context }) => send('RETRY_UPDATE', { count: context.retries })
            ]
          },
          onError: { 
            target: 'retry',
            actions: assign({
              retries: ({ context }) => context.retries + 1
            })
          }
        }
      },
      fourth: {
        invoke: {
          src: fromPromise(({ input }) => generateNumberAndCheck(input.min, input.max, input.index)),
          input: ({ context }) => ({ min: 75, max: 100, index: 3, retries: context.retries }),
          onDone: { 
            target: 'success',
            actions: [
              assign({
                results: ({ context, event }) => [...context.results, event.output]
              }),
              () => send('STATUS_UPDATE', { status: 'Success' })
            ]
          },
          onError: { 
            target: 'retry',
            actions: assign({
              retries: ({ context }) => context.retries + 1
            })
          }
        }
      },
      retry: {
        entry: ({ context }) => {
          send('RETRY_UPDATE', { count: context.retries });
          console.log(`Retry attempt ${context.retries}`);
        },
        always: [
          { 
            target: 'first', 
            guard: ({ context }) => context.retries < 20 
          },
          { 
            target: 'failure', 
            actions: [() => send('STATUS_UPDATE', { status: 'Failed' })]
          }
        ]
      },
      success: { type: 'final' },
      failure: { type: 'final' }
    }
  });

  const generateNumberAndCheck = (min: number, max: number, index: number) => {
    return new Promise<number>((resolve, reject) => {
      const value = Math.floor(Math.random() * 100) + 1;
      send('BOX_UPDATE', { index, value });
      
      setTimeout(() => {
        if (value >= min && value <= max) {
          console.log(`✅ Box ${index + 1} success: ${value}`);
          resolve(value);
        } else {
          console.log(`❌ Box ${index + 1} failed: ${value} (expected ${min}-${max})`);
          reject(`Value ${value} out of range [${min}-${max}]`);
        }
      }, 1000);
    });
  };

  ws.on('message', (message) => {
    console.log('Received:', message.toString());
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'START_WORKFLOW') {
        console.log('Starting workflow...');
        send('STATUS_UPDATE', { status: 'running' });
        
        const actor = createActor(workflowMachine);
        
        actor.subscribe((snapshot) => {
          console.log('State:', snapshot.value);
        });
        
        actor.start();
      } else if (data.type == 'HANDLE_IN_VM') {
        send('APPLY_ACTIONS');
      } else if (data.type == 'DONE_FROM_VM') {
        send('DONE_FROM_VM');
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });

  // Send initial connection message
  send('STATUS_UPDATE', { status: 'Ready' });
});