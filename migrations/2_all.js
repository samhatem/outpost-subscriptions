const TestToken = artifacts.require('TestToken');
const SubscriptionV0 = artifacts.require('SubscriptionV0')
const SuperfluidSDK = require("@superfluid-finance/ethereum-contracts");

module.exports = async function (deployer, _, accounts) {
  const alice = accounts[0]

  const sf = new SuperfluidSDK.Framework({
    chainId: 5,
    version: process.env.SUPERFLUID_VERSION,
    web3Provider: web3.currentProvider
  });
  await sf.initialize();

  // MIGRATE THE TEST TOKEN
  const tokenName = 'JammSession'
  const rewardToken = await deployer.deploy(TestToken, tokenName, 'JAMM')

  console.log(rewardToken.address, 'address of the created token')

  const tokenInfoName = await rewardToken.name.call();
  const tokenInfoSymbol = await rewardToken.symbol.call();
  const tokenInfoDecimals = await rewardToken.decimals.call();
  console.log("Token address", rewardToken.address);
  console.log("Token name", tokenName);
  console.log("Token info name()", tokenInfoName);
  console.log("Token info symbol()", tokenInfoSymbol);
  console.log("Token info decimals()", tokenInfoDecimals.toString());

  let superTokenWrapper = await sf.getERC20Wrapper(rewardToken)
  if (!superTokenWrapper.created) {
    console.log("Creating the wrapper...");
    await sf.createERC20Wrapper(rewardToken, alice);
    console.log("Wrapper created.");
  } else {
    console.log("SuperToken wrapper already created.");
  }

  // MIGRATE THE SUBSCIPTION CONTRACT

  const daiAddress = await sf.resolver.get("tokens.fDAI");
  const dai = await sf.contracts.TestToken.at(daiAddress);
  const daixWrapper = await sf.getERC20Wrapper(dai);
  const daix = await sf.contracts.ISuperToken.at(daixWrapper.wrapperAddress);

  const sub = await deployer.deploy(
    SubscriptionV0,
    sf.host.address,
    sf.agreements.cfa.address,
    daix.address,
    TestToken.address
  )

  console.log(`Contract deployed at ${sub.address}`)

  // FUND THE CONTRACT

  superTokenWrapper = await sf.getERC20Wrapper(rewardToken)
  console.log(superTokenWrapper.wrapperAddress, 'The wrapper address')
  const tokenx = await sf.contracts.ISuperToken.at(superTokenWrapper.wrapperAddress)

  await rewardToken.mint(alice, web3.utils.toWei("2000000", "ether"), { from: alice })
  await rewardToken.approve(tokenx.address, web3.utils.toWei("2000000", "ether"), { from: alice })
  await tokenx.upgrade(web3.utils.toWei("1000000", "ether"), { from: alice })
  await tokenx.transfer(sub.address, web3.utils.toWei("1000000", "ether"), { from: alice })
}
