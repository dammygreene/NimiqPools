import { apiError, json } from "@/lib/http";
import type { FootballFixtureOption } from "@/app/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FootballDataMatch = {
  id: number;
  competition?: { code?: string; name?: string };
  homeTeam?: { name?: string };
  awayTeam?: { name?: string };
  utcDate?: string;
  status?: string;
  matchday?: number | null;
  venue?: string | null;
};

type ApiSportsFixture = {
  id?: number;
  date?: string;
  time?: string;
  timestamp?: number;
  status?: { long?: string } | string;
  fixture?: {
    id?: number;
    date?: string;
    status?: { long?: string };
    venue?: { name?: string | null };
  };
  league?: {
    country?: string;
    name?: string;
  };
  teams?: {
    home?: { name?: string };
    away?: { name?: string };
  };
};

function isUpcomingStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  return [
    "scheduled",
    "timed",
    "not started",
    "ns",
    "tbd",
    "time to be defined",
  ].includes(normalized);
}

function primaryProviderForSport(sport: string): "FOOTBALL_DATA" | "API_SPORTS" {
  return sport === "football" ? "FOOTBALL_DATA" : "API_SPORTS";
}

async function footballDataFixtures(): Promise<FootballFixtureOption[]> {
  if (!process.env.FOOTBALL_DATA_API_KEY) return [];
  try {
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 10 * 24 * 3_600_000).toISOString().slice(0, 10);
    const url = new URL("https://api.football-data.org/v4/matches");
    url.searchParams.set("dateFrom", today);
    url.searchParams.set("dateTo", end);
    url.searchParams.set("status", "SCHEDULED");
    const response = await fetch(url, {
      headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_API_KEY },
      cache: "no-store",
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { matches?: FootballDataMatch[] };
    return (data.matches ?? [])
      .filter((match) => isUpcomingStatus(String(match.status ?? "SCHEDULED")))
      .slice(0, 40)
      .map((match) => ({
        id: match.id,
        provider: "FOOTBALL_DATA",
        sport: "football",
        competitionCode: String(match.competition?.code ?? ""),
        competitionName: String(match.competition?.name ?? "Football"),
        homeTeam: String(match.homeTeam?.name ?? "Home"),
        awayTeam: String(match.awayTeam?.name ?? "Away"),
        utcDate: String(match.utcDate ?? ""),
        status: String(match.status ?? "SCHEDULED"),
        matchday: match.matchday ?? null,
        venue: match.venue ?? null,
      }));
  } catch {
    return [];
  }
}

async function apiSportsFootballFixtures(): Promise<FootballFixtureOption[]> {
  if (!process.env.API_SPORTS_KEY) return [];
  try {
    const url = new URL("https://v3.football.api-sports.io/fixtures");
    url.searchParams.set("next", "40");
    const response = await fetch(url, {
      headers: { "x-apisports-key": process.env.API_SPORTS_KEY },
      cache: "no-store",
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { response?: ApiSportsFixture[] };
    return (data.response ?? []).flatMap((item) => {
      if (!item.fixture?.id) return [];
      const status = String(item.fixture?.status?.long ?? "Scheduled");
      if (!isUpcomingStatus(status)) return [];
      return [{
        id: item.fixture.id,
        provider: "API_SPORTS",
        sport: "football",
        competitionCode: String(item.league?.country ?? ""),
        competitionName: String(item.league?.name ?? "Football"),
        homeTeam: String(item.teams?.home?.name ?? "Home"),
        awayTeam: String(item.teams?.away?.name ?? "Away"),
        utcDate: String(item.fixture?.date ?? ""),
        status,
        matchday: null,
        venue: item.fixture?.venue?.name ?? null,
      }];
    });
  } catch {
    return [];
  }
}

async function apiSportsGenericFixtures(sport: "basketball" | "baseball"): Promise<FootballFixtureOption[]> {
  if (!process.env.API_SPORTS_KEY) return [];
  try {
    const host = sport === "basketball" ? "https://v1.basketball.api-sports.io/games" : "https://v1.baseball.api-sports.io/games";
    const fixtures: FootballFixtureOption[] = [];

    for (let offset = 0; offset < 30 && fixtures.length < 40; offset += 1) {
      const date = new Date(Date.now() + offset * 24 * 3_600_000).toISOString().slice(0, 10);
      const url = new URL(host);
      url.searchParams.set("date", date);
      const response = await fetch(url, {
        headers: { "x-apisports-key": process.env.API_SPORTS_KEY },
        cache: "no-store",
      });
      if (!response.ok) return fixtures;
      const data = (await response.json()) as { response?: ApiSportsFixture[] };
      fixtures.push(
        ...(data.response ?? []).flatMap((item) => {
          const id = item.fixture?.id ?? item.id;
          if (!id) return [];
          const utcDate = item.fixture?.date ?? item.date ?? (item.timestamp ? new Date(item.timestamp * 1000).toISOString() : `${date}T18:00:00Z`);
          const status = typeof item.status === "string" ? item.status : item.status?.long;
          if (!isUpcomingStatus(String(status ?? item.fixture?.status?.long ?? "Scheduled"))) return [];
          return [{
            id,
            provider: "API_SPORTS" as const,
            sport,
            competitionCode: String(item.league?.country ?? ""),
            competitionName: String(item.league?.name ?? `${sport[0].toUpperCase()}${sport.slice(1)}`),
            homeTeam: String(item.teams?.home?.name ?? "Home"),
            awayTeam: String(item.teams?.away?.name ?? "Away"),
            utcDate: String(utcDate),
            status: String(item.fixture?.status?.long ?? status ?? "Scheduled"),
            matchday: null,
            venue: item.fixture?.venue?.name ?? null,
          }];
        }),
      );
    }

    return fixtures;
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sport = url.searchParams.get("sport") || "football";
    const primaryProvider = primaryProviderForSport(sport);
    let fixtures: FootballFixtureOption[] = [];

    if (sport === "football") {
      fixtures = await footballDataFixtures();
      if (!fixtures.length) fixtures = await apiSportsFootballFixtures();
    } else if (sport === "basketball" || sport === "baseball") {
      fixtures = await apiSportsGenericFixtures(sport);
    }

    fixtures = fixtures
      .filter((fixture) => isUpcomingStatus(String(fixture.status ?? "")))
      .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime())
      .slice(0, 40);

    return json({
      fixtures,
      source: fixtures.length ? fixtures[0].provider : "NONE",
      primaryProvider,
    });
  } catch (error) {
    return apiError(error);
  }
}
