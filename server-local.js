const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const handleRequest = (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Solicitud inválida');
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(root, `.${pathname}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    res.writeHead(403).end('Acceso denegado');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('No se encontró el archivo');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
};

function startServer(port) {
  const server = http.createServer(handleRequest);
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && port < 3010) {
      console.log(`El puerto ${port} está ocupado. Probando el puerto ${port + 1}…`);
      startServer(port + 1);
      return;
    }
    console.error('No se pudo iniciar el servidor:', error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`App disponible en http://localhost:${port}`);
    console.log('Deja esta ventana abierta mientras usas la app. Para detener: Ctrl+C.');
  });
}

const preferredPort = Number(process.env.PORT) || 3000;
startServer(preferredPort);
