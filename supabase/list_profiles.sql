select p.id as user_id, p.username, p.role, p.email, p.created_at
from public.profiles p
order by p.created_at;
