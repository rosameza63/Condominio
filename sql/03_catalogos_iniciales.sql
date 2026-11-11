-- Opciones iniciales acordadas para Altos del Parque.
-- Los tipos de PQR quedan vacíos para que administración defina su catálogo.

insert into public.tipos_residente (codigo, nombre) values
  ('propietario', 'Propietario'),
  ('habitante', 'Habitante')
on conflict (codigo) do nothing;

insert into public.tipos_vehiculo (codigo, nombre) values
  ('carro', 'Carro'),
  ('camioneta', 'Camioneta'),
  ('moto', 'Moto'),
  ('bicicleta', 'Bicicleta'),
  ('otros', 'Otros')
on conflict (codigo) do nothing;

-- Ejemplo para cuando acuerden las categorías de PQR:
-- insert into public.tipos_pqr (codigo, nombre)
-- values ('mantenimiento', 'Mantenimiento'), ('convivencia', 'Convivencia');
