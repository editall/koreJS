const express = require('express');
const app = express();
const path = require('path');

// Cross-Origin 설정
app.use((req, res, next) => {
  res.header('Cross-Origin-Embedder-Policy', 'require-corp');
  res.header('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

// 정적 파일 제공
app.use(express.static(path.join(__dirname, '')));

app.listen(3000, () => console.log('Server started on port 3000'));
