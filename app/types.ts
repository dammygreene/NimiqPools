export type ResolverType =
  | "BINANCE"
  | "COINGECKO"
  | "FOOTBALL_DATA"
  | "API_SPORTS"
  | "OPEN_METEO"
  | "MANUAL";

export type MarketStatus =
  | "DRAFT"
  | "OPEN"
  | "LOCKED"
  | "AWAITING_RESULT"
  | "EVIDENCE_WINDOW"
  | "RESOLUTION_DELAYED"
  | "RESOLVED"
  | "PAYOUT_PENDING"
  | "PAID"
  | "REFUND_PENDING"
  | "REFUNDED";

export interface ResolutionProof {
  provider: string;
  providerReference?: string;
  requestedSettlementAt?: string;
  providerTimestamp?: string;
  observedValue?: string | number;
  explanation: string;
}

export interface Pool {
  id: string;
  shareId: string;
  question: string;
  category: string;
  resolverType: ResolverType;
  resolverConfig: Record<string, string | number>;
  outcomes: string[];
  stakeAmountLuna: number;
  creatorAddress: string;
  escrowAddress: string;
  predictionClosesAt: string;
  eventResolvesAt: string;
  resolutionDeadline: string;
  status: MarketStatus;
  resolvedOutcome: string | null;
  observedValue: string | number | null;
  resolutionProof: ResolutionProof | null;
  participantCount: number;
  potLuna: number;
  outcomeBreakdown: Array<{
    outcome: string;
    count: number;
    percentage: number;
  }>;
  createdAt: string;
  settlementRule: string;
  refundRule: string;
  evidenceRequirements: string;
}

export interface EvidenceSubmission {
  id: string;
  poolId: string;
  submittedBy: string;
  proposedOutcome: string;
  evidenceUrl?: string;
  description: string;
  submittedAt: string;
}

export interface SignedPredictionPayload {
  domain: "nimiq-pools";
  version: 1;
  poolId: string;
  participantAddress: string;
  selectedOutcome: string;
  stakeAmountLuna: number;
  predictionClosesAt: string;
  nonce: string;
}

export interface ReferralCode {
  address: string;
  code: string;
  shareUrl: string;
  createdAt: string;
}

export interface Referral {
  code: string;
  referrerAddress: string;
  referredAddress: string;
  status: "pending" | "verified";
  firstStakeTxHash: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface RewardsPool {
  address: string;
  totalFunded: number;
  totalDistributed: number;
  remaining: number;
}

export interface RewardEvent {
  id: string;
  address: string;
  type: "signup" | "referral";
  amount: number;
  triggerTxHash: string;
  status: "pending" | "claimed";
  claimTxHash: string | null;
  createdAt: string;
  claimedAt: string | null;
}

export interface ReferralLeaderboardEntry {
  rank: number;
  address: string;
  verifiedCount: number;
  totalEarned: number;
}

export interface FootballFixtureOption {
  id: number | string;
  provider: "FOOTBALL_DATA" | "API_SPORTS" | "DEMO";
  sport: string;
  competitionCode: string;
  competitionName: string;
  homeTeam: string;
  awayTeam: string;
  utcDate: string;
  status: string;
  matchday: number | null;
  venue: string | null;
}

export interface ReferralDashboard {
  referralCode: ReferralCode;
  verifiedReferralCount: number;
  referralEarned: number;
  signupReward: RewardEvent | null;
  claimableRewards: RewardEvent[];
  rewardsPool: RewardsPool;
  leaderboard: ReferralLeaderboardEntry[];
  ownRank: ReferralLeaderboardEntry;
  rewardsPoolDepleted: boolean;
}
