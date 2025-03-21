const { User } = require('../models');

const generateSafiriUsername = async (fullName) => {
  if (!fullName) throw new Error('Full name is required');

  //... Convert full name to lowercase and replace spaces with dots...//
  let baseUsername = fullName.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '');

  //==== Append `.eth.safiri` to the username ===//
  baseUsername = `${baseUsername}.eth.safiri`;

  //==== Check if the username already exists ===//
  let username = baseUsername;
  let counter = 1;
  
  while (await User.findOne({ where: { safiriUsername: username } })) {
    username = `${fullName.toLowerCase().replace(/\s+/g, '.')}${counter}.eth.safiri`;
    counter++;
  }

  return username;
};

module.exports = generateSafiriUsername;
