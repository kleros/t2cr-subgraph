import { Address, BigInt, ByteArray, Bytes, crypto } from "@graphprotocol/graph-ts";
import { ArbitrableTokenList, RequestSubmitted, TokenStatusChange } from "../generated/ArbitrableTokenList/ArbitrableTokenList";
import { IArbitrator } from "../generated/ArbitrableTokenList/IArbitrator";
import { Request, Token, Registry, Round } from "../generated/schema";

// Result
const PENDING = 'Pending'
const ACCEPTED = 'Accepted'
const REJECTED = 'Rejected'

// RequestType
const REGISTRATION = 'Registration'
const REMOVAL = 'Removal'

// Status
const ABSENT = "Absent"
const REGISTERED = "Registered"
const REGISTRATION_REQUESTED = "RegistrationRequested"
const CLEARING_REQUESTED = "ClearingRequested"

// Ruling
const NONE = "None"
const ACCEPT = "Accept"
const REJECT = "Reject"

let ZERO_ADDRESS =
  Bytes.fromHexString("0x0000000000000000000000000000000000000000") as Bytes

function concatByteArrays(a: ByteArray, b: ByteArray): ByteArray {
  let out = new Uint8Array(a.length + b.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  for (let j = 0; j < b.length; j++) out[a.length + j] = b[j];
  return out as ByteArray;
}

export function handleRequestSubmitted(event: RequestSubmitted): void {
  let token = Token.load(event.params._tokenID.toHexString());
  let tcr = ArbitrableTokenList.bind(event.address);
  let registry = Registry.load(event.address.toHexString());
  let tokenInfo = tcr.getTokenInfo(event.params._tokenID);

  if (token == null) {
    token = new Token(event.params._tokenID.toHexString());
    registry.numberOfSubmissions++;

    token.registry = registry.id
    token.name = tokenInfo.value0;
    token.ticker = tokenInfo.value1;
    token.address = tokenInfo.value2;
    token.symbolMultihash = tokenInfo.value3;
    token.status = tokenInfo.value4 == 2
      ? REGISTRATION_REQUESTED
      : CLEARING_REQUESTED;

    token.numberOfRequests = BigInt.fromI32(0);
  }

  token.numberOfRequests = token.numberOfRequests.plus(BigInt.fromI32(1));

  let request = new Request(
    token.id + '-0'
  )
  request.token = token.id
  request.submissionTime = event.block.timestamp;
  request.result = PENDING
  request.type = token.status == REGISTRATION_REQUESTED
    ? REGISTRATION
    : REMOVAL;
  request.requester = event.transaction.from;
  request.resolutionTime = BigInt.fromI32(0);
  request.disputed = false;
  request.disputeID = BigInt.fromI32(0);
  request.challenger = ZERO_ADDRESS
  request.disputeOutcome = NONE;
  request.numberOfRounds = BigInt.fromI32(1);
  request.arbitrator = tcr.arbitrator();
  request.arbitratorExtraData = tcr.arbitratorExtraData();
  request.evidenceGroupID = BigInt.fromUnsignedBytes(
    crypto.keccak256(
      concatByteArrays(
        event.params._tokenID,
        ByteArray.fromI32(1)
      )
    ) as Bytes
  );

  request.metaEvidenceURI = request.type == REGISTRATION
    ? registry.registrationMetaEvidenceURI
    : registry.registrationMetaEvidenceURI

  let round = new Round(
    request.id + '-0'
  )
  round.request = request.id;
  let arbitrator = IArbitrator.bind(request.arbitrator as Address);
  let arbitrationCost = arbitrator.arbitrationCost(request.arbitratorExtraData);
  round.amountPaidRequester = arbitrationCost.plus(
    arbitrationCost.times(tcr.sharedStakeMultiplier()).div(tcr.MULTIPLIER_DIVISOR())
  );
  round.amountPaidChallenger = BigInt.fromI32(0)
  round.hasPaidRequester = true;
  round.hasPaidChallenger = false;
  round.feeRewards = round.amountPaidRequester;

  round.save()
  request.save()
  token.save()
  registry.save()
}

export function handleTokenStatusChange(event: TokenStatusChange): void {

}