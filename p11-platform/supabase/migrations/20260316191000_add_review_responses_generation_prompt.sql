alter table public.review_responses
add column if not exists generation_prompt text;
