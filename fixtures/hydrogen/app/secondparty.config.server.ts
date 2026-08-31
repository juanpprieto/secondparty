import {defineSecondparty, type CacheLike} from 'secondparty';

// Oxygen provides env at request time, not at module load. Build the config once
// per isolate from the first request's env. Ids come from SP_* vars; never commit one.
type SpEnv = {SP_KLAVIYO_COMPANY_ID?: string; SP_YOTPO_LOADER_ID?: string};

let sp:
  | ReturnType<typeof defineSecondparty<Record<string, {url: string; ttl?: number}>>>
  | undefined;

export function getSecondparty(env: SpEnv) {
  if (sp) return sp;
  const entries: Record<string, {url: string; ttl?: number}> = {
    fbevents: {url: 'https://connect.facebook.net/en_US/fbevents.js'},
    vimeo: {url: 'https://player.vimeo.com/api/player.js', ttl: 86400},
  };
  if (env.SP_KLAVIYO_COMPANY_ID) {
    entries.klaviyo = {
      url: `https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=${env.SP_KLAVIYO_COMPANY_ID}`,
    };
  }
  if (env.SP_YOTPO_LOADER_ID) {
    entries.yotpo = {
      url: `https://cdn-widgetsrepository.yotpo.com/v1/loader/${env.SP_YOTPO_LOADER_ID}`,
    };
  }
  sp = defineSecondparty({
    entries,
    // JSON lines on stdout; read them with the Shopify CLI log stream.
    onEvent: (e) =>
      console.log(
        JSON.stringify({
          sp: e.type,
          key: e.key,
          site: e.site,
          hash: 'hash' in e ? e.hash : undefined,
          status: 'status' in e ? e.status : undefined,
          code: 'error' in e ? e.error.code : undefined,
        }),
      ),
  });
  return sp;
}

export type Secondparty = ReturnType<typeof getSecondparty>;
export type SpContext = {secondparty: Secondparty; spCache: CacheLike};
