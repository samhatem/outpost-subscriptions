const HDWalletProvider = require('@truffle/hdwallet-provider');
require('dotenv').config()

const MNEMONIC = process.env.MNEMONIC
const INFURA_ID = process.env.INFURA_ID

module.exports = {
  networks: {
    development: {
      port: 8545,
      network_id: '*',
      host: '127.0.0.1'
    },

    goerli: {
      provider: () => new HDWalletProvider(MNEMONIC, `https://goerli.infura.io/v3/${INFURA_ID}`),
      network_id: 5,
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true,
      gasPrice: 10000000000
    }
  },

  mocha: {
    timeout: 1000000
  },

  // Configure your compilers
  compilers: {
    solc: {
      version: "0.7.3",
    }
  }
}
