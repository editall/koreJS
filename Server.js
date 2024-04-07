const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    const filePath = path.join(
        __dirname,
        // 'build/dist/js/productionExecutable',
        req.url.endsWith(".tpl") || req.url.endsWith(".js") ? req.url.split("/").pop() : 'index.html');
    console.log('req.url', req.url, "filePath", filePath);
    const extname = path.extname(filePath);
    let contentType = 'text/html';
    switch (extname) {
        case '.js':
            contentType = 'text/javascript';
            break;
    }
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(500);
            res.end(`Server Error: ${err.code}`);
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});
server.listen(3010, () => {
    console.log('Server is running on port 3000');
});