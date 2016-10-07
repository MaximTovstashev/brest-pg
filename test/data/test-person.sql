DROP TABLE IF EXISTS public.test_person CASCADE;

CREATE TABLE public.test_person (
	id serial PRIMARY KEY,
	name character varying NOT NULL,
	attitude character varying,
	height int NOT NULL,
	iq int
);

INSERT INTO public.test_person (name, attitude, height, iq)
VALUES
('John Doe', 	'bad', 		180, 	90),
('Jane Doe', 	'bad', 		175, 	85),
('John Smith', 	NULL, 		165, 	85),
('Pete Frum', 	'worst', 	200, 	NULL),
('Some Guy', 	'best', 	190, 	120);