import type { User } from "@supabase/supabase-js";

export interface HeaderProps {
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
}

export interface AuthContextType{
    user:User | null;
    role:string | null;
    loading:boolean;
}

export interface blogProps  {
    id:string | null;
    title:string | null;
    content:string | null;
    category:string | null;
    is_recurring_feed?: boolean | null;
    author_display_name?: string | null;
    created_at?: string | null;

}

export interface AuthError extends Error {
  name: string;
  message: string;
  status?: number;
  code?: string;
}

export interface subscriptionError extends Error {
  name: string;
  message: string;
  status?: number;
  code?: string;
}