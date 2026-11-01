import net from 'node:net';

export function portIsBusy(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', error => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(new Error(`Cannot check local port: ${error.code || error.message}`));
    });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Local port check timed out')); });
  });
}
