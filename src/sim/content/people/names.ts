/**
 * Name pools for townies and Create-a-Zombie randomise — gothic, punny and aggressively ordinary.
 * All original; no franchise characters.
 */

export const FIRST_NAMES: string[] = [
  // gothic / old-fashioned
  'Mortimer', 'Ghoulia', 'Agnes', 'Ebenezer', 'Cornelius', 'Prudence', 'Mildred', 'Bartholomew', 'Ignatius',
  'Winifred', 'Ophelia', 'Thaddeus', 'Euphemia', 'Lucretia', 'Barnaby', 'Cordelia', 'Ambrose', 'Hortense',
  'Percival', 'Gertrude', 'Ezekiel', 'Philippa', 'Silas', 'Theodora', 'Edmund', 'Isadora', 'Leopold',
  'Henrietta', 'Cuthbert', 'Mathilda', 'Rupert', 'Constance', 'Algernon', 'Beatrix', 'Horatio', 'Imogen',
  'Octavia', 'Montgomery', 'Clementine', 'Archibald', 'Florence', 'Wilhelmina', 'Bertram', 'Augusta',
  'Desmond', 'Delphine', 'Fenwick', 'Lavinia', 'Jasper', 'Rosalind', 'Obadiah', 'Temperance', 'Mordecai',
  'Vesper', 'Ravenna', 'Dorian', 'Sybil', 'Ulric', 'Ysolde', 'Eustace', 'Griselda', 'Lazarus',
  // punny
  'Rotney', 'Morty', 'Rigor', 'Cadavera', 'Embalmina', 'Mouldred', 'Rotrick', 'Tomb', 'Tombias',
  'Cryptopher', 'Stiffany', 'Decayla', 'Morgana', 'Mausoleah', 'Tibia', 'Patella', 'Clavicula', 'Vertebrad',
  'Groania', 'Moanica', 'Grimothy', 'Bonita', 'Ghoulbert', 'Brainard', 'Cerebella', 'Neuronica', 'Lobelia',
  'Medulla', 'Gangreta', 'Putrick', 'Rotger', 'Dustin', 'Femurdith', 'Marrowena', 'Shamblin', 'Gravelyn',
  // ordinary (being dead is no reason to change your name)
  'Gerald', 'Doris', 'Harold', 'Linda', 'Kevin', 'Brenda', 'Gary', 'Susan', 'Dave', 'Barbara', 'Steve',
  'Nancy', 'Frank', 'Carol', 'Doug', 'Janet', 'Walter', 'Phyllis', 'Norman', 'Pam', 'Dennis', 'Gail', 'Ron',
  'Sharon', 'Earl', 'Judy', 'Ralph', 'Deborah', 'Stan', 'Peggy', 'Larry', 'Wanda', 'Clive', 'Maureen',
  'Trevor', 'Beverly', 'Roy', 'Edna', 'Neil', 'Gloria', 'Keith', 'Irene', 'Lloyd', 'Vera', 'Howard', 'Rita',
  'Wendell', 'Dot',
];

export const LAST_NAMES: string[] = [
  'Gravesby', 'Moulder', 'Formaldi', 'Coffinsworth', 'Bonewright', 'Cryptley', 'Tombsworth', 'Ashgrove',
  'Rotwell', 'Decayne', 'Mausley', 'Shroudsworth', 'Stiffleton', 'Mouldsworth', 'Hollowell', 'Gravelle',
  'Marrowby', 'Cadaverly', 'Mossgrave', 'Blackthorn', 'Nightshade', 'Hemlock', 'Thornbury', 'Wither',
  'Dankworth', 'Mildew', 'Mustyford', 'Crumble', 'Plotkin', 'Digby', 'Shovell', 'Spadeworth', 'Grimwald',
  'Ghoulsby', 'Moanington', 'Groanberg', 'Shambles', 'Rigorson', 'Skullworth', 'Femurson', 'Hearsely',
  'Urnsby', 'Dusterhoff', 'Cobbwebb', 'Creaker', 'Squeakley', 'Putrescu', 'Stenchworth', 'Whiffington',
  'Fumington', 'Graveney', 'Underhill', 'Sixfoot', 'Deepdale', 'Dredge', 'Mourne', 'Weepwood', 'Sorrowby',
  'Dirge', 'Lament', 'Knell', 'Ravenscroft', 'Crowe', 'Rookwood', 'Darkmoor', 'Fogg', 'Mistley',
  'Gloomsbury', 'Drearie', 'Bleakley', 'Murkwood', 'Damply', 'Soggins', 'Grubb', 'Maggotti', 'Wormsley',
  'Mothsworth', 'Gristle', 'Sinew', 'Tendonelli', 'Stitchworth', 'Sewell', 'Mummery', 'Wrapley',
  'Linenfold', 'Embersley', 'Coldwater', 'Frostmire', 'Pallsworth', 'Tollbury',
];

/** Townie occupation flavour (shown in the townie list; not a playable career). */
export const OCCUPATIONS: string[] = [
  'Gravedigger',
  'Cemetery Night Watch',
  'Funeral Florist',
  'Taxidermist',
  'Organist at St. Mildew’s',
  'Librarian (Restricted Section)',
  'Hearse Driver',
  'Tombstone Engraver',
  'Coffin Carpenter',
  'Bone Setter',
  'Wig Maker',
  'Professional Mourner',
  'Séance Medium',
  'Fog Machine Technician',
  'Bat Wrangler',
  'Candle Maker',
  'Embalming Fluid Sales Rep',
  'Cemetery Landscaper',
  'Mausoleum Realtor',
  'Ghost Tour Guide',
  'Moth Breeder',
  'Cursed Antiques Dealer',
  'Pallbearer for Hire',
  'Bell Ringer',
  'Raven Trainer',
  'Eulogy Writer',
  'Night-Shift Nurse',
  'Insurance Adjuster (Acts of Ghoul)',
  'Barista at The Daily Grindstone',
  'Sewer Inspector',
  'Lighthouse Keeper',
  'Accordion Teacher',
  'Retired Opera Singer',
  'Mushroom Forager',
  'Clock Repairer',
  'Garden Gnome Restorer',
  'Hellhound Dog Walker',
  'Bookbinder',
  'Locksmith',
  'Retired Gym Teacher',
];

/** Service NPC naming (createService). */
export const SERVICE_NAMES = {
  pizza: {
    first: ['Pepperoni', 'Crusty', 'Deep-Dish', 'Calzone', 'Garlic', 'Anchovy'],
    last: ['Pete', 'Paulie', 'Patty', 'Pam', 'Phil', 'Pip'],
    occupation: 'Pizza Delivery Ghoul',
  },
  repo: {
    first: ['Grimsby', 'Mortimer', 'Ledger', 'Collector', 'Foreclosure', 'Lien'],
    last: ['Repossessor', 'Takesworth', 'Grabbitt', 'Clawback', 'Seizewell', 'Debtmore'],
    occupation: 'Repo Ghoul',
  },
} as const;
