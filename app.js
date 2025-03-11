require('dotenv').config();

const express = require("express");
const app = express();
const cors = require('cors');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended: true}))




app.get('/', (req, res) => {
    res.send("Interacting with safiri at the moment")
})




app.listen(process.env.PORT, ()=>{
    console.log(`server started : ${process.env.PORT}`)
})
