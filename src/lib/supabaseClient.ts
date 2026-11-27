import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;
let cachedKey = '';

export function getSupabaseClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
): SupabaseClient {
  const compositeKey = `${supabaseUrl}::${supabaseAnonKey}`;
  if (cachedClient && cachedKey === compositeKey) {
    return cachedClient;
  }
  cachedClient = createClient(supabaseUrl, supabaseAnonKey);
  cachedKey = compositeKey;
  return cachedClient;
}
