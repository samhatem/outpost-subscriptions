const UniswapV2Router02 = artifacts.require('UniswapV2Router02')
const SuperfluidSDK = require('@superfluid-finance/ethereum-contracts')

const GOERLI_ROUTER_ADDRESS = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'

const MY_ADDRESS = process.env.MY_ADDRESS

module.exports = async function (_, __, accounts) {
  if ((await web3.eth.net.getId()) !== 5 /* goerli */) {
    return
  }

  const alice = accounts[0]

  console.log(alice, 'THE ACCOUNT WE USING')

  const UniRouter = await UniswapV2Router02.at(GOERLI_ROUTER_ADDRESS)

  let sf = new SuperfluidSDK.Framework({
    chainId: 5,
    version: process.env.SUPERFLUID_VERSION,
    web3Provider: web3.currentProvider
  })
  await sf.initialize()

  const daiAddress = await sf.resolver.get('tokens.fDAI')
  const dai = await sf.contracts.TestToken.at(daiAddress)

  const MINT_AMOUNT = web3.utils.toWei('20000000', 'ether')

  await dai.mint(MY_ADDRESS, MINT_AMOUNT, { from: alice })
  await dai.mint(alice, MINT_AMOUNT, { from: alice })

  await dai.approve(UniRouter.address, MINT_AMOUNT, { from: alice })
  await UniRouter.addLiquidityETH(
    dai.address,
    50,
    1,
    2,
    MY_ADDRESS,
    (await web3.eth.getBlock('latest')).timestamp + 100000000000,
    { from: alice, value: web3.utils.toWei("2", "ether") }
  )
}
