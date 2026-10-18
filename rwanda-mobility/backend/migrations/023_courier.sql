-- Parcel delivery by moto ("courier"): what is being sent. The recipient's phone is kept in the guest columns (erased on the usual schedule), never here.
alter table bookings add column parcel jsonb;
