const HDWalletProvider = require('@truffle/hdwallet-provider');
require('dotenv').config()

const MNEMONIC = process.env.MNEMONIC
const INFURA_ID = process.env.INFURA_ID

module.exports = {
  networks: {
    goerli: {
      provider: () => new HDWalletProvider(MNEMONIC, `http://localhost:8545`),
      network_id: 5,
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true,
      gasPrice: 10000000000
    }
  },

  // Configure your compilers
  compilers: {
    solc: {
      version: "0.7.1",
    }
  }
}
