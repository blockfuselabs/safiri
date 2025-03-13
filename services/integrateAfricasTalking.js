require("dotenv").config();
const africaStalkingData = require("africastalking");
const { User } = require('../models');
const { ethers } = require('ethers');

const africaStalking = africaStalkingData({
    apiKey: "",
    username: 'sandbox',
})

const ERC20_ABI = [
    "function transferFrom(address sender, address recipient, uint256 amount) external returns (bool)",
    "function transfer(address recipient, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
];

const provider = process.env.ETH_PROVIDER_URL;
const ethProvider = new ethers.JsonRpcProvider(provider);
const tokenAddress = process.env.CONTRACT_ADDRESS;





exports.ussdAccess = async (req, res) => {
    const {sesionId, serviceCode, phoneNumber, text} = req.body;

    let response; 
    let fullName = '';
    let passcode = '';
    

    if(text == ''){
        response = 'CON Welcome to safiri \n 1. create an acccount \n 2. Check account balance '
    }

    if(text == '1') {
        response = 'CON Enter fullname ';
    }

    if(text == '2') {
        try {
            const userExist = await User.findOne({ where: { phoneNumber } });

            const tokenContract = await new ethers.Contract(tokenAddress, ERC20_ABI, ethProvider);
            const userAddress = userExist.walletAddress;

            const userBalance = await tokenContract.balanceOf(userAddress);

            response = `END Your account balance is ${userBalance} safiri`

            console.log("This is the safiri token balance", response);

        } catch (error) {
            response = 'END could not check balance at the moment'
        }
    }

    if(text !== '') {
        let array = text.split('*')

        if(array.length === 2) {
            if(parseInt(array[0]) == 1) {
                fullName = array[1]
                response = 'CON Enter your passcode'
            }
        }

        if(array.length === 3) {
            if(parseInt(array[0]) == 1) {
                fullName = array[1]
                passcode = array[2]


                if(!fullName || !phoneNumber || !passcode) {
                    response = 'END Incomplete signup details'
                }

                try {
                    const userExist = await User.findOne({ where: { phoneNumber } });

                    console.log("existence of user",userExist)

                    if (userExist) {
                        throw new Error("You already have an account"); 
                    }

                    const wallet = ethers.Wallet.createRandom();

                    const privateKey = wallet.privateKey;
                    const walletAddress = wallet.address;

                    const user = await User.create({
                        fullName,
                        phoneNumber,
                        walletAddress,
                        privateKey,
                        pin: passcode,
                        status: false,
                    });

                    console.log("the user id is:", user.id);

                    await user.save();

                    response = 'END Account created successfully'
                } catch (error) {
                    response = `END ${error}`
                    
                }
                

                console.log("Phonenumber is: ", phoneNumber);
                console.log("Fullname is: ", fullName);
                console.log("Passcode is:", passcode);

                
            }
        }
    }

    

    
        
        
    

    setTimeout(()=>{
        res.send(response)
        res.end()
    }, 2000)
    
}

module.exports = exports;