const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));

const upload = multer({ dest: 'uploads/' });

app.post('/count-rows', upload.single('file'), (req, res) => {
  const content = fs.readFileSync(req.file.path, 'utf8');
  const rowCount = content.split('\n').length;
  fs.unlinkSync(req.file.path); // cleanup
  res.json({ rows: rowCount });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
