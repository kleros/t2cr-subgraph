import { Address, BigInt, ByteArray, Bytes, crypto } from "@graphprotocol/graph-ts";
import { ArbitrableTokenList, FundAppealCall, RequestSubmitted, Ruling, SubmitEvidenceCall, TokenStatusChange } from "../generated/ArbitrableTokenList/ArbitrableTokenList";
import { IArbitrator } from "../generated/ArbitrableTokenList/IArbitrator";
import { Request, Token, Registry, Round, Evidence } from "../generated/schema";

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
  request.numberOfEvidences = BigInt.fromI32(0);
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
  let tcr = ArbitrableTokenList.bind(event.address);
  let token = Token.load(event.params._tokenID.toHexString())
  let request = Request.load(`${token.id}-${token.numberOfRequests.minus(BigInt.fromI32(1))}`)
  if (event.params._challenger == ZERO_ADDRESS) {
    // If there is no challenger, either:
    // - This is a new request;
    // - A request was executed (i.e. it was accepted).

    if (token.status == REGISTRATION_REQUESTED || token.status == CLEARING_REQUESTED) {
      return // New requests are handled in handleRequestSubmitted.
    }

    // Request executed.
    request.resolutionTime = event.block.timestamp
    token.status = request.type == REGISTRATION_REQUESTED
      ? token.status = REGISTERED
      : token.status = ABSENT;

    token.save();
    request.save();
    return
  }

  // Other cases where the event is emmited are:
  // - Dispute created;
  // - Dispute appealed;
  // - Ruling enforced.

  // Ruling enforcement is handled in handleRuling, so we'll skip it here.
  if (request.resolutionTime.gt(BigInt.fromI32(0))) return;

  let round = Round.load(`${request.id}-${request.numberOfRounds.minus(BigInt.fromI32(1))}`)

  let newRound = new Round(`${request.id}-${request.numberOfRounds}`)
  newRound.request = request.id
  newRound.amountPaidRequester = BigInt.fromI32(0)
  newRound.amountPaidChallenger = BigInt.fromI32(0)
  newRound.feeRewards = BigInt.fromI32(0)
  newRound.hasPaidRequester = false;
  newRound.hasPaidChallenger = false;

  request.numberOfRounds = request.numberOfRounds.plus(BigInt.fromI32(1));

  let arbitrator = IArbitrator.bind(request.arbitrator as Address);

  if (!event.params._appealed) {
    // Request was challenged (i.e. dispute created).
    let arbitrationCost = arbitrator.arbitrationCost(request.arbitratorExtraData);
    round.amountPaidChallenger = arbitrationCost.plus(
      arbitrationCost.times(tcr.sharedStakeMultiplier()).div(tcr.MULTIPLIER_DIVISOR())
    );
    round.feeRewards = round.feeRewards.plus(
      arbitrationCost.times(tcr.sharedStakeMultiplier()).div(tcr.MULTIPLIER_DIVISOR())
    )

  } else {
    // Dispute appealed.
    let appealCost = arbitrator.appealCost(request.disputeID, request.arbitratorExtraData);
    round.feeRewards = round.feeRewards.minus(appealCost)
  }

  request.save()
  round.save()
  newRound.save()
  token.save()
}

export function handleRuling(event: Ruling): void {
  let tcr = ArbitrableTokenList.bind(event.address);
  let tokenID = tcr.arbitratorDisputeIDToTokenID(event.params._arbitrator, event.params._disputeID);
  let token = Token.load(tokenID.toHexString());
  let request = Request.load(`${token.id}-${token.numberOfRequests.minus(BigInt.fromI32(1))}`)

  let winner = event.params._ruling;
   // Update token state
   if (winner.equals(BigInt.fromI32(1))) { // Execute Request
      if (token.status == REGISTRATION_REQUESTED)
          token.status = REGISTERED;
      else
          token.status = ABSENT;
  } else { // Revert to previous state.
      if (token.status == REGISTRATION_REQUESTED)
          token.status = ABSENT;
      else
          token.status = REGISTERED;
  }

  request.resolutionTime = event.block.timestamp;
  request.result = winner.equals(BigInt.fromI32(0))
    ? NONE
    : winner.equals(BigInt.fromI32(1))
    ? ACCEPT
    : REJECT;

  request.save();
  token.save();
}

export function handleFundAppeal(call: FundAppealCall): void {

}

export function handleSubmitEvidence(call: SubmitEvidenceCall): void {
  let token = Token.load(call.inputs._tokenID.toHexString())
  let request = Request.load(
    `${token.id}-${token.numberOfRequests.minus(BigInt.fromI32(1))}`
  )

  let evidence = new Evidence(
    `${request.id}-${request.numberOfEvidences}`
  )
  evidence.submissionTime = call.block.timestamp;
  evidence.submitter = call.from;
  evidence.evidenceURI = call.inputs._evidence;
  evidence.request = request.id;

  request.numberOfEvidences = request.numberOfEvidences.plus(BigInt.fromI32(1));
}