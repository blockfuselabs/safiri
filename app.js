require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { sequelize } = require('./models');


const app = express();

app.options('*', cors());

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

app.get('/', (req, res) => {
    res.send("Interacting with safiri platform")
})

// app.post('/', )


sequelize.sync({ alter: true }).then(() => {
    app.listen(process.env.PORT, () => {
      console.log(`Server running on port ${process.env.PORT}`);
    });
});
  