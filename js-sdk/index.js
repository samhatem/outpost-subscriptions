const SubscriptionABI = require('./sub-abi.js')
const SfABI = require('./sf-abi.js')
const { ethers } = require('ethers')

const SF_VERSION = '0.1.2-preview-20201014'
const RESOLVER_ADDRESS = '0x3710AB3fDE2B61736B8BB0CE845D6c61F667a78E'

function Framework (web3Provider) {
  this.version = SF_VERSION

  this.resolver = new ethers.Contract(RESOLVER_ADDRESS, SfABI.IResolver, web3Provider)

  this.provider = web3Provider
}

Framework.prototype.init = async function () {
  const superfluidAddress = await this.resolver.get(`Superfluid.${this.version}`)
  const cfaAddress = await this.resolver.get(`ConstantFlowAgreementV1.${this.version}`)
  const idaAddress = await this.resolver.get(`InstantDistributionAgreementV1.${this.version}`)
  console.debug('Superfluid', superfluidAddress)
  console.debug('ConstantFlowAgreementV1', cfaAddress)
  console.debug('InstantDistributionAgreementV1', idaAddress)

  this.host = new ethers.Contract(superfluidAddress, SfABI.ISuperfluid, this.provider)
  this.agreements = {
    cfa: new ethers.Contract(cfaAddress, SfABI.IConstantFlowAgreementV1, this.provider),
    ida: new ethers.Contract(idaAddress, SfABI.IInstantDistributionAgreementV1, this.provider)
  }
}

module.exports = {
  SubscriptionABI,
  Framework,
  ISuperTokenABI: SfABI.ISuperToken,
  ERC20WithTokenInfoABI: SfABI.ERC20WithTokenInfo,
  SfABI
}
