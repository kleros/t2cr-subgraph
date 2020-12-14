import { log, BigInt } from "@graphprotocol/graph-ts";
import { RequestSubmitted, TokenStatusChange } from "../generated/ArbitrableTokenList/ArbitrableTokenList";
import { Request, Token } from "../generated/schema";


const PENDING = 'Pending'
const ACCEPTED = 'Accepted'
const REJECTED = 'Rejected'

const REGISTRATION = 'Registration'
const REMOVAL = 'Removal'

export function handleRequestSubmitted(event: RequestSubmitted): void {
  let token = Token.load(event.params._tokenID.toHexString())
  if (token == null) {
    token = new Token(event.params._tokenID.toHexString())
    token.numberOfRequests = BigInt.fromI32(1)
  } else {
    token.numberOfRequests = token.numberOfRequests.plus(BigInt.fromI32(1))
  }
  token.save()

  let id = event.params._tokenID.toHexString()+'-'+token.numberOfRequests.minus(BigInt.fromI32(1)).toString()
  let request = new Request(id)

  request.submissionTime = event.block.timestamp
  request.result = PENDING
  request.type = event.params._registrationRequest
    ? REGISTRATION
    : REMOVAL
  request.requester = event.transaction.from

  request.resolutionTime = BigInt.fromI32(0)
  request.save()
}

export function handleTokenStatusChange(event: TokenStatusChange): void {
  if (event.params._status !== 0 && event.params._status !== 1) {
    return // Request not yet resolved. Noop.
  }

  let token = Token.load(event.params._tokenID.toHexString())
  if (token == null) {
    log.error('T2CR: token {} not found. Bailing handleTokenStatusChange.',[event.params._tokenID.toHexString()])
    return
  }
  let id = event.params._tokenID.toHexString()+'-'+token.numberOfRequests.minus(BigInt.fromI32(1)).toString()

  let request = Request.load(id)
  if (request == null) {
    log.error('T2CR: Request {} not found. Bailing handleTokenStatusChange.',[id])
    return
  }

  request.resolutionTime = event.block.timestamp;
  if (request.type === REGISTRATION) {
    if (event.params._status === 0) {
      request.result = REJECTED
    } else {
      request.result = ACCEPTED
    }
  } else {
    if (event.params._status === 0) {
      request.result = ACCEPTED
    } else {
      request.result = REJECTED
    }
  }

  request.save()
}