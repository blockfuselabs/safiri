const { User } = require('../models');

exports.verifyUser = async (req, res) => {
    try {
        // const phoneNumber = "+2348123456789";
        const phoneNumber2 = "+2348123456780";

        // const userExist = await User.findOne({ where: { phoneNumber } });
        const userExist2 = await User.findOne({ where: { phoneNumber: phoneNumber2 } });

        if (!userExist2) {
            console.log("User does not exist");
        } else {
            console.log(userExist2);
            // userExist.status = true;
            /*userExist2.phoneNumber = "+2348012345678";
            await userExist.save();
            userExist.phoneNumber = phoneNumber2;
            await userExist.save();
            console.log("Users phone updated", userExist, userExist2);*/
        }
    } catch (error) {
        
        console.error(error);
    }
}

module.exports = exports;
