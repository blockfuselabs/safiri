'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      User.hasMany(models.Transaction, { 
        foreignKey: 'user_id', 
        as: 'transactions', 
        onDelete: 'CASCADE' 
      });
    }
  }
  User.init({
    id: {
      type: DataTypes.BIGINT,  // Ensure this matches user_id in Transactions
      autoIncrement: true,
      primaryKey: true
    },
    fullName: DataTypes.STRING,
    //.... safiri username....//
    safiriUsername: {
      type: DataTypes.STRING,
      unique: true, //...Ensure no duplicates//
      allowNull: false
    },
    email: DataTypes.STRING,
    password: DataTypes.STRING,
    walletAddress: DataTypes.STRING,
    privateKey: DataTypes.TEXT,
    pin: DataTypes.INTEGER,
    status: DataTypes.BOOLEAN,
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'User',
    tableName: 'users',
  });
  return User;
};