
/* ---------- SEN accommodations (added to Differentiation for each ticked category) ---------- */
const PLUS_SEN = {
 'Visual impairment':{en:'Visual impairment: seat near the board, read aloud what is written, use large print and objects to touch.',fr:'Déficience visuelle : placer près du tableau, lire à voix haute ce qui est écrit, utiliser de gros caractères et des objets à toucher.',rw:'Ubumuga bwo kutabona: bicara hafi y\'ikibaho, usome mu ijwi riranguruye ibyanditswe, ukoreshe inyandiko nini n\'ibintu bikorwaho.'},
 'Hearing impairment':{en:'Hearing impairment: seat at the front facing the teacher, speak clearly while facing the class, add gestures, pictures and written key words.',fr:'Déficience auditive : placer devant face à l\'enseignant(e), parler clairement face à la classe, ajouter gestes, images et mots clés écrits.',rw:'Ubumuga bwo kutumva: bicara imbere berekeye umwarimu, vuga neza urebye abanyeshuri, wongereho ibimenyetso, amashusho n\'amagambo y\'ingenzi yanditse.'},
 'Physical disability':{en:'Physical disability: keep a clear path, let the learner work at an easy-to-reach place, give extra time and allow a partner to help with writing or moving.',fr:'Handicap physique : dégager le passage, placer l\'élève à un endroit accessible, donner plus de temps et permettre l\'aide d\'un camarade pour écrire ou se déplacer.',rw:'Ubumuga bw\'ingingo: reka inzira iboneye, ushyire umunyeshuri ahantu byoroshye kugera, umuhe igihe cyiyongereye umwemerere umufasha kwandika cyangwa kugenda.'},
 'Learning difficulty':{en:'Learning difficulty: break the task into small steps, repeat key words, use concrete objects and give one instruction at a time.',fr:'Difficulté d\'apprentissage : découper la tâche en petites étapes, répéter les mots clés, utiliser des objets concrets et donner une consigne à la fois.',rw:'Ingorane mu kwiga: gabanya umurimo mu ntambwe nto, subiramo amagambo y\'ingenzi, ukoreshe ibintu nyabyo utange amabwiriza rimwe rimwe.'},
 'Gifted and talented':{en:'Gifted and talented: give an extension task (a harder or open question) and let the learner help to explain to a partner.',fr:'Élèves doués : donner une tâche d\'extension (question plus difficile ou ouverte) et laisser l\'élève aider à expliquer à un camarade.',rw:'Abanyeshuri bafite impano: bahe umurimo wo kwagura (ikibazo kigoye cyangwa gifunguye) ubareke bafashe mugenzi wabo gusobanura.'},
 'Slow learners':{en:'Slow learners: give extra examples and time, pair with a supportive partner and check understanding often with short questions.',fr:'Apprenants lents : donner des exemples et du temps en plus, associer à un camarade qui aide et vérifier souvent la compréhension par de courtes questions.',rw:'Abiga buhoro: tanga ingero n\'igihe cyiyongereye, ubashyire hamwe n\'umufasha kandi usuzume kenshi ko basobanukiwe ukoresheje ibibazo bigufi.'}
};
/* ---------- ICT tools: low-cost options first, because REB scores ICT use (40 of 100 points) ---------- */
const PLUS_ICT = {
 phone:{ name:'Teacher\'s phone', t:{en:'teacher\'s phone (shows pictures, audio or a short offline video)',fr:'téléphone de l\'enseignant(e) (images, audio ou courte vidéo hors ligne)',rw:'telefoni y\'umwarimu (amashusho, amajwi cyangwa videwo ngufi idakenera murandasi)'},
        why:{en:'it is always available and shows content the class can see and hear together',fr:'il est toujours disponible et montre un contenu que la classe voit et entend ensemble',rw:'iboneka igihe cyose kandi yerekana ibyo ishuri ryose rishobora kubona no kumva hamwe'}},
 radio:{ name:'Radio', t:{en:'radio (REB / community radio lesson or recording)',fr:'radio (leçon ou enregistrement REB / radio communautaire)',rw:'radiyo (isomo cyangwa amajwi ya REB / radiyo y\'abaturage)'},
        why:{en:'it reaches the whole class without electricity or internet',fr:'elle atteint toute la classe sans électricité ni internet',rw:'igera ku ishuri ryose idakeneye umuriro cyangwa murandasi'}},
 projector:{ name:'Projector', t:{en:'projector or large screen',fr:'projecteur ou grand écran',rw:'porojegiteri cyangwa ikinyabutumwa kinini'},
        why:{en:'every learner sees the same content clearly',fr:'chaque élève voit clairement le même contenu',rw:'buri munyeshuri abona neza ibintu bimwe'}},
 laptop:{ name:'Laptop / computer', t:{en:'laptop or computer',fr:'ordinateur',rw:'mudasobwa'},
        why:{en:'it holds the lesson resources and lets learners try tasks on screen',fr:'il contient les ressources de la leçon et permet d\'essayer des tâches à l\'écran',rw:'ibitse ibikoresho by\'isomo kandi ituma abanyeshuri bagerageza imirimo kuri ecran'}},
 tablet:{ name:'Tablet', t:{en:'tablet',fr:'tablette',rw:'tablet'},
        why:{en:'small groups can share it to practise and get instant feedback',fr:'de petits groupes peuvent le partager pour s\'exercer et recevoir un retour immédiat',rw:'amatsinda mato ashobora kuyisangira kwitoza no kubona ibisubizo ako kanya'}},
 elearn:{ name:'REB e-learning / Smart School App', t:{en:'REB e-learning resources or the Smart School App',fr:'ressources REB e-learning ou application Smart School App',rw:'ibikoresho bya REB e-learning cyangwa porogaramu Smart School App'},
        why:{en:'it gives official REB content and practice with instant feedback',fr:'il donne le contenu officiel de REB et des exercices avec retour immédiat',rw:'itanga ibikubiye bya REB n\'imyitozo ifite ibisubizo ako kanya'}},
 video:{ name:'Offline video / audio', t:{en:'downloaded video or audio clip',fr:'vidéo ou audio téléchargé',rw:'videwo cyangwa amajwi yakuwe kuri murandasi'},
        why:{en:'it shows a real example that is hard to bring into the classroom',fr:'il montre un exemple réel difficile à apporter en classe',rw:'yerekana urugero nyarwo bigoye kuzana mu ishuri'}},
 calc:{ name:'Calculator', t:{en:'calculator',fr:'calculatrice',rw:'kalikilatere'},
        why:{en:'learners check their own answers and focus on reasoning',fr:'les élèves vérifient leurs réponses et se concentrent sur le raisonnement',rw:'abanyeshuri basuzuma ibisubizo byabo bakibanda ku gutekereza'}}
};
const PLUS_ICT_TXT = {
 purpose:{en:'Learners look, listen, discuss and answer questions about the content, so the tool supports interaction and not only display.',fr:'Les élèves regardent, écoutent, discutent et répondent à des questions sur le contenu : l\'outil favorise l\'interaction et pas seulement l\'affichage.',rw:'Abanyeshuri bareba, bumva, baganira kandi basubiza ibibazo ku bikubiye mu isomo, ku buryo igikoresho gifasha mu kuganira ntigikoreshwa mu kwerekana gusa.'},
 impact:{en:'Learners stay more attentive, take part more and remember the key content better.',fr:'Les élèves sont plus attentifs, participent davantage et retiennent mieux le contenu clé.',rw:'Abanyeshuri barushaho kwitonda, kugira uruhare no kwibuka ibikubiye mu isomo.'},
 achieve:{en:'Check learners\' answers in the exit ticket; compare with previous results to see the effect of the tool.',fr:'Vérifier les réponses des élèves au billet de sortie ; comparer avec les résultats précédents pour voir l\'effet de l\'outil.',rw:'Suzuma ibisubizo by\'abanyeshuri mu bibazo bisoza isomo; ugereranye n\'ibyavuye mbere urebe icyo igikoresho cyahinduye.'},
 tools:{en:'Tools used: ',fr:'Outils utilisés : ',rw:'Ibikoresho bikoreshwa: '},
 res:{en:'Resource / link: ',fr:'Ressource / lien : ',rw:'Igikoresho / ihuza: '},
 none:{en:'No ICT tool is used in this lesson; learners use the chalkboard and the pupil book.',fr:'Aucun outil TIC n\'est utilisé dans cette leçon ; les élèves utilisent le tableau et le livre de l\'élève.',rw:'Nta gikoresho cy\'ikoranabuhanga gikoreshwa muri iri somo; abanyeshuri bakoresha ikibaho n\'igitabo cy\'umunyeshuri.'}
};
const PLUS_UI = {  /* labels for the extra printed sections */
 criteria:{en:'Success criteria (I can ...)',fr:'Critères de réussite (Je peux ...)',rw:'Ibimenyetso by\'ugutsinda (Nshobora ...)'},
 terms:{en:'Key terms',fr:'Mots clés',rw:'Amagambo y\'ingenzi'},
 prior:{en:'Prior knowledge / next lesson',fr:'Acquis préalables / leçon suivante',rw:'Ibyo bazi mbere / isomo rikurikira'},
 exit:{en:'Exit ticket (last 3-5 minutes) and answers',fr:'Billet de sortie (3-5 dernières minutes) et réponses',rw:'Ibibazo bisoza isomo (iminota 3-5 ya nyuma) n\'ibisubizo'},
 hw:{en:'Homework / extension',fr:'Devoir / prolongement',rw:'Imikoro yo mu rugo / kwagura'},
 rubric:{en:'Rubric (how well can the learner do it?)',fr:'Grille (dans quelle mesure l\'élève sait-il le faire ?)',rw:'Ipimiro (umunyeshuri abikora ate?)'},
 approach:{en:'Teaching approach',fr:'Approche pédagogique',rw:'Uburyo bwo kwigisha'},
 prevl:{en:'Previous lesson',fr:'Leçon précédente',rw:'Isomo ryabanje'}, nextl:{en:'Next lesson',fr:'Leçon suivante',rw:'Isomo rikurikira'},
 ans:{en:'Answer',fr:'Réponse',rw:'Igisubizo'}, name:{en:'Name',fr:'Nom',rw:'Izina'}, cls:{en:'Class',fr:'Classe',rw:'Ishuri'}, date:{en:'Date',fr:'Date',rw:'Itariki'},
 worksheet:{en:'Worksheet',fr:'Fiche d\'exercices',rw:'Urupapuro rw\'imyitozo'}, key:{en:'Answer key',fr:'Corrigé',rw:'Ibisubizo'},
 order:{en:'Put in the correct order',fr:'Remets dans le bon ordre',rw:'Shyira ku murongo ukwiye'}, draw:{en:'Draw your answer in the box.',fr:'Dessine ta réponse dans le cadre.',rw:'Shushanya igisubizo cyawe mu kazu.'},
 levels:[{en:'4 Exceeds',fr:'4 Dépasse',rw:'4 Arengeje'},{en:'3 Meets',fr:'3 Atteint',rw:'3 Yabigezeho'},{en:'2 Approaching',fr:'2 Presque',rw:'2 Yegereje'},{en:'1 Beginning',fr:'1 Début',rw:'1 Atangiye'}],
 desc:[{en:'does this correctly and alone, and can help others',fr:'le fait correctement et seul(e) et peut aider les autres',rw:'abikora neza wenyine kandi yafasha abandi'},
        {en:'does this correctly with little help',fr:'le fait correctement avec peu d\'aide',rw:'abikora neza afashijwe gake'},
        {en:'does this in part; needs help or a reminder',fr:'le fait en partie ; a besoin d\'aide ou d\'un rappel',rw:'abikora igice; akeneye ubufasha cyangwa kwibutswa'},
        {en:'cannot yet do this; needs re-teaching',fr:'ne sait pas encore le faire ; a besoin d\'un réenseignement',rw:'ntarabasha kubikora; akeneye kwigishwa bundi bushya'}],
 oral:[{en:'Say in your own words what "{t}" means.',fr:'Dis avec tes propres mots ce que signifie « {t} ».',rw:'Sobanura mu magambo yawe icyo « {t} » bivuze.'},
       {en:'Give one example from daily life for "{t}".',fr:'Donne un exemple de la vie quotidienne pour « {t} ».',rw:'Tanga urugero rumwe rwo mu buzima bwa buri munsi kuri « {t} ».'},
       {en:'Show or do one task like the one in the lesson.',fr:'Montre ou fais une tâche comme celle de la leçon.',rw:'Erekana cyangwa ukore umurimo umeze nk\'uwo mu isomo.'}],
 hwdef:{en:'Practise the lesson at home and bring one example or question to share next lesson.',fr:'S\'exercer à la maison et apporter un exemple ou une question à partager à la prochaine leçon.',rw:'Ongera witoze mu rugo uzane urugero rumwe cyangwa ikibazo cyo gusangiza mu isomo rikurikira.'}
};
const PLUS_BLOOM = 'identify|name|list|state|recall|define|describe|explain|summari[sz]e|compare|classify|give|show|demonstrate|solve|calculate|apply|use|measure|construct|draw|write|read|spell|pronounce|sing|perform|play|act|analy[sz]e|evaluate|justify|design|create|compose|distinguish|differentiate|match|sort|count|add|subtract|multiply|divide|convert|estimate|round|order|arrange|label|locate|predict|record|present|discuss|translate|conjugate|decrire|expliquer|identifier|nommer|calculer|resoudre|resoudre|ecrire|lire|comparer|classer|montrer|utiliser|mesurer|dessiner|gusoma|kwandika|gusobanura|kuvuga|kubara|gukoresha|kugereranya|gutandukanya|gushushanya|gukemura|kumenya|gutanga|kwerekana|gusubiza|kurondora';
const PLUS_VAGUE = /\b(understand|know|learn|appreciate|be aware|be familiar|comprendre|savoir|connaitre|connaître|gusobanukirwa|kumenya neza)\b/i;
