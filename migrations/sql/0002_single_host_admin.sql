-- Un único administrador: la máquina anfitriona del nodo.
-- Los roles de miembro ya no otorgan permisos de gestión, así que cualquier
-- role heredado de la versión anterior (owner/admin) se degrada a member.
UPDATE members SET role = 10, updated_at = now() WHERE role <> 10;
