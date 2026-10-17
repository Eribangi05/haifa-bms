/* ============================================================================
   EduSmart Lesson Studio - features layered on the REB generator (lessonplan.js).
   Learned from the 20 tools reviewed (MagicSchool, Eduaide, Education Copilot, Edcafe, Tutero, Brisk, Common Planner,
   Khanmigo, Twee, Diffit, Aila, Curipod, To-Teach, ...): teaching models, success criteria, exit tickets with an answer key,
   rubrics, worksheets, differentiation and SEN accommodations, a plan library with search and a week planner, Word export
   and an "improve with AI" prompt. Everything here works offline and is built on the REB scheme data and the REB template.
   Scoring follows REB's own "Model lesson template: evaluation criteria" (15 + 10 + 30 + 40 + 5 points).
   ============================================================================ */
const PLUS_L = ['en','fr','rw'];
function plusLang(){ const l=lpLang(); return l==='fr'||l==='rw'?l:'en'; }
function tx(o){ if(typeof o==='string') return o; return (o&&(o[plusLang()]||o.en))||''; }
function plusSplit(total, ratios){   /* whole minutes that add up exactly to total (largest remainder, at least 1 each) */
  const s=ratios.reduce((a,b)=>a+b,0); const raw=ratios.map(r=>total*r/s); const out=raw.map(x=>Math.max(1,Math.floor(x)));
  let diff=total-out.reduce((a,b)=>a+b,0); const order=raw.map((x,i)=>[x-Math.floor(x),i]).sort((a,b)=>b[0]-a[0]);
  for(let k=0;diff>0&&k<1000;k++){ out[order[k%order.length][1]]++; diff--; }
  for(let k=0;diff<0&&k<1000;k++){ const i=out.map((v,j)=>[v,j]).sort((a,b)=>b[0]-a[0])[0][1]; if(out[i]>1){ out[i]--; diff++; } else break; }
  return out;
}
const PLUS_ENG = (s)=>String(s||'').replace(/\s+/g,' ').trim();
function plusFirstSentence(t){ const s=PLUS_ENG(t); const m=s.match(/^(.{12,}?[.;:!?])(\s|$)/); return (m?m[1]:s).replace(/[.;:]$/,''); }

/* ---------- teaching approaches: three timed development steps each ---------- */
const PLUS_MODELS = {
 reb:{ name:'REB participatory (timed steps)', share:[30,45,25],
  steps:{
   en:[['Teacher presents','The teacher introduces the new content with examples and questions, using the pupil book and local materials.','Listen, ask and answer questions, and note the key points.'],
       ['Pair / group work','The teacher forms pairs or groups, gives the task from the lesson and moves around guiding and giving feedback.','Work together on the task, share ideas and record their answers.'],
       ['Presentation and feedback','The teacher invites groups to present, corrects misconceptions and highlights the key points.','Present their work, listen to others and correct their own work.']],
   fr:[['Présentation par l\'enseignant(e)','L\'enseignant(e) présente le nouveau contenu avec des exemples et des questions, à l\'aide du livre de l\'élève et du matériel local.','Écoutent, posent et répondent aux questions et notent les points clés.'],
       ['Travail en binômes / groupes','L\'enseignant(e) forme des binômes ou des groupes, donne la tâche de la leçon, circule et donne des retours.','Travaillent ensemble sur la tâche, partagent leurs idées et notent leurs réponses.'],
       ['Présentation et retour','L\'enseignant(e) invite les groupes à présenter, corrige les erreurs et souligne les points clés.','Présentent leur travail, écoutent les autres et corrigent leur travail.']],
   rw:[['Umwarimu arasobanura','Umwarimu atangiza ibikubiye mu isomo akoresheje ingero n\'ibibazo, akoresheje igitabo cy\'umunyeshuri n\'ibikoresho byo mu gace.','Barumva, bakabaza kandi bagasubiza, bakandika ingingo z\'ingenzi.'],
       ['Gukorera mu matsinda','Umwarimu ashyira abanyeshuri mu matsinda cyangwa mu mpuzandengo, abaha umurimo w\'isomo, akazenguruka abayobora.','Bakorera hamwe umurimo, bagasangira ibitekerezo kandi bakandika ibisubizo.'],
       ['Kugaragaza ibyakozwe','Umwarimu asaba amatsinda kugaragaza ibyakozwe, agakosora ibitari byo akagaragaza ingingo z\'ingenzi.','Bagaragaza ibyakozwe, bakumva abandi kandi bagakosora umurimo wabo.']]}},
 gradual:{ name:'I do - We do - You do (gradual release)', share:[30,35,35],
  steps:{
   en:[['I do (teacher models)','The teacher explains and works one or two examples on the board, thinking aloud.','Watch and listen, and ask about anything unclear.'],
       ['We do (guided practice)','The teacher and learners work examples together; the teacher asks questions and corrects as they go.','Answer questions, try steps with the teacher and correct mistakes together.'],
       ['You do (independent practice)','The teacher gives a short task, moves around checking work and helps individuals.','Work alone on the task, then check answers with a partner.']],
   fr:[['Je fais (modélisation)','L\'enseignant(e) explique et résout un ou deux exemples au tableau en pensant à voix haute.','Observent, écoutent et demandent des précisions.'],
       ['Nous faisons (pratique guidée)','L\'enseignant(e) et les élèves résolvent des exemples ensemble ; l\'enseignant(e) questionne et corrige au fur et à mesure.','Répondent aux questions, essaient les étapes avec l\'enseignant(e) et corrigent les erreurs ensemble.'],
       ['Tu fais (pratique autonome)','L\'enseignant(e) donne une courte tâche, circule pour vérifier et aide individuellement.','Travaillent seuls sur la tâche puis vérifient leurs réponses avec un camarade.']],
   rw:[['Njyewe nkora (umwarimu yerekana)','Umwarimu asobanura agakemura urugero rumwe cyangwa ebyiri ku kibaho avuga mu ijwi riranguruye uko atekereza.','Barareba bakumva kandi bakabaza ibitumvikana.'],
       ['Dukorana (imyitozo iyobowe)','Umwarimu n\'abanyeshuri bakemura ingero hamwe; umwarimu abaza ibibazo agakosora uko bigenda.','Basubiza ibibazo, bagerageza intambwe hamwe n\'umwarimu bagakosora amakosa hamwe.'],
       ['Mukora mwenyine (imyitozo ku giti cyawe)','Umwarimu atanga umurimo mugufi, akazenguruka asuzuma imirimo kandi agafasha buri wese.','Bakora umurimo ku giti cyabo, hanyuma bagasuzuma ibisubizo hamwe n\'mugenzi wabo.']]}},
 e5:{ name:'5E (Engage - Explore - Explain - Elaborate - Evaluate)', share:[35,30,35],
  steps:{
   en:[['Explore','The teacher gives a short hands-on or discussion task so learners meet the idea themselves; the teacher observes and asks probing questions.','Investigate in pairs or groups, discuss what they notice and record ideas.'],
       ['Explain','The teacher gathers the groups\' findings, introduces the key terms and explains the concept using the pupil book.','Share findings, listen, and connect the key terms to what they found.'],
       ['Elaborate','The teacher gives a new, slightly different task so learners apply the idea in another situation.','Apply the idea to the new task and explain their reasoning.']],
   fr:[['Explorer','L\'enseignant(e) propose une courte tâche pratique ou une discussion pour que les élèves découvrent l\'idée ; il observe et pose des questions.','Cherchent en binômes ou en groupes, discutent de ce qu\'ils observent et notent leurs idées.'],
       ['Expliquer','L\'enseignant(e) rassemble les découvertes des groupes, introduit les termes clés et explique la notion avec le livre de l\'élève.','Partagent leurs découvertes, écoutent et relient les termes clés à ce qu\'ils ont trouvé.'],
       ['Approfondir','L\'enseignant(e) propose une tâche nouvelle, un peu différente, pour appliquer l\'idée dans une autre situation.','Appliquent l\'idée à la nouvelle tâche et expliquent leur raisonnement.']],
   rw:[['Gucukumbura','Umwarimu atanga umurimo mugufi w\'intoki cyangwa ikiganiro kugira ngo abanyeshuri bahure n\'igitekerezo ubwabo; areba akabaza ibibazo.','Bashakashaka mu matsinda, bakaganira ku byo babonye bakandika ibitekerezo.'],
       ['Gusobanura','Umwarimu akusanya ibyo amatsinda yabonye, agatangiza amagambo y\'ingenzi akanasobanura ingingo akoresheje igitabo.','Basangira ibyo babonye, bakumva, bagahuza amagambo y\'ingenzi n\'ibyo babonye.'],
       ['Kwagura','Umwarimu atanga umurimo mushya utandukanye gato kugira ngo abanyeshuri bakoreshe igitekerezo mu bundi buryo.','Bakoresha igitekerezo ku murimo mushya bagasobanura uko batekereje.']]}},
 inquiry:{ name:'Inquiry (question - investigate - conclude)', share:[25,50,25],
  steps:{
   en:[['Pose the question','The teacher poses a real-life question linked to the lesson and helps learners say what they already know.','Discuss the question and suggest first answers.'],
       ['Investigate','The teacher provides materials or sources (pupil book, objects, a short activity) and guides groups as they look for evidence.','Investigate in groups, collect evidence and record what they find.'],
       ['Conclude','The teacher helps groups compare evidence, agree on an answer and link it to the key content.','Present conclusions, give reasons and compare with other groups.']],
   fr:[['Poser la question','L\'enseignant(e) pose une question tirée de la vie réelle liée à la leçon et aide les élèves à dire ce qu\'ils savent.','Discutent de la question et proposent des premières réponses.'],
       ['Investiguer','L\'enseignant(e) fournit du matériel ou des sources (livre, objets, courte activité) et guide les groupes qui cherchent des preuves.','Enquêtent en groupes, recueillent des preuves et notent ce qu\'ils trouvent.'],
       ['Conclure','L\'enseignant(e) aide les groupes à comparer les preuves, à s\'accorder sur une réponse et à la relier au contenu clé.','Présentent leurs conclusions, donnent des raisons et comparent avec les autres groupes.']],
   rw:[['Kubaza ikibazo','Umwarimu abaza ikibazo cyo mu buzima busanzwe gifitanye isano n\'isomo akafasha abanyeshuri kuvuga ibyo basanzwe bazi.','Baganira ku kibazo bagatanga ibisubizo by\'ibanze.'],
       ['Gusesengura','Umwarimu atanga ibikoresho cyangwa inkomoko (igitabo, ibintu, igikorwa kigufi) akayobora amatsinda ashaka ibimenyetso.','Basesengura mu matsinda, bakusanya ibimenyetso bakandika ibyo babonye.'],
       ['Gusoza','Umwarimu afasha amatsinda kugereranya ibimenyetso, kumvikana ku gisubizo akagihuza n\'ibikubiye mu isomo.','Bagaragaza imyanzuro, batanga impamvu bakagereranya n\'andi matsinda.']]}},
 coop:{ name:'Cooperative learning (roles and group products)', share:[20,55,25],
  steps:{
   en:[['Form groups and give roles','The teacher forms mixed-ability groups of 4-5, gives each member a role (leader, reporter, timekeeper, writer) and explains the task.','Move into groups, take a role and clarify the task.'],
       ['Group task','The teacher moves between groups, asks guiding questions and makes sure every member takes part.','Complete the group task together; each member contributes and checks the others.'],
       ['Share and reflect','The teacher invites reporters to share, praises good teamwork and corrects misconceptions.','Reporters present; the class asks questions and reflects on how the group worked.']],
   fr:[['Former les groupes et attribuer les rôles','L\'enseignant(e) forme des groupes hétérogènes de 4-5, donne un rôle à chacun (chef, rapporteur, gardien du temps, secrétaire) et explique la tâche.','Se mettent en groupes, prennent un rôle et clarifient la tâche.'],
       ['Tâche de groupe','L\'enseignant(e) circule entre les groupes, pose des questions et veille à la participation de chacun.','Réalisent la tâche ensemble ; chacun contribue et vérifie les autres.'],
       ['Partage et réflexion','L\'enseignant(e) invite les rapporteurs, félicite le bon travail d\'équipe et corrige les erreurs.','Les rapporteurs présentent ; la classe pose des questions et réfléchit au fonctionnement du groupe.']],
   rw:[['Gushyiraho amatsinda n\'inshingano','Umwarimu ashyiraho amatsinda y\'abanyeshuri 4-5 bafite urwego rutandukanye, agaha buri wese inshingano (umuyobozi, uvugira itsinda, ugenzura igihe, wandika) akanasobanura umurimo.','Bajya mu matsinda, buri wese agafata inshingano akumva umurimo.'],
       ['Umurimo w\'itsinda','Umwarimu azenguruka amatsinda, abaza ibibazo biyobora kandi akareba ko buri wese agira uruhare.','Bakora umurimo hamwe; buri wese atanga umusanzu agasuzuma abandi.'],
       ['Gusangira no gutekereza','Umwarimu asaba ababwira amatsinda gusangiza, agashima ubufatanye akanakosora ibitari byo.','Ababwira amatsinda barabigaragaza; ishuri rirabaza rigatekereza uko itsinda ryakoranye.']]}},
 direct:{ name:'Direct instruction (explain - model - practise)', share:[30,30,40],
  steps:{
   en:[['Explain','The teacher states the objective and explains the key idea clearly, step by step, with a short example.','Listen carefully and note the key idea.'],
       ['Model','The teacher demonstrates how to do the task and shows what a correct answer looks like.','Watch the demonstration and try the first step.'],
       ['Practise with feedback','The teacher sets practice tasks, checks work as learners finish and corrects common errors straight away.','Practise the task, show their work and correct mistakes.']],
   fr:[['Expliquer','L\'enseignant(e) énonce l\'objectif et explique l\'idée clé clairement, étape par étape, avec un court exemple.','Écoutent attentivement et notent l\'idée clé.'],
       ['Modéliser','L\'enseignant(e) montre comment faire la tâche et à quoi ressemble une bonne réponse.','Observent la démonstration et essaient la première étape.'],
       ['S\'exercer avec retour','L\'enseignant(e) propose des exercices, vérifie les travaux et corrige tout de suite les erreurs courantes.','S\'exercent, montrent leur travail et corrigent leurs erreurs.']],
   rw:[['Gusobanura','Umwarimu avuga intego akanasobanura igitekerezo gikuru neza, intambwe ku yindi, akoresheje urugero rugufi.','Bumva bitonze bakandika igitekerezo gikuru.'],
       ['Kwerekana','Umwarimu yerekana uko umurimo ukorwa n\'uko igisubizo cyiza kimeze.','Barareba bagerageza intambwe ya mbere.'],
       ['Imyitozo n\'ibitekerezo','Umwarimu atanga imyitozo, agasuzuma abarangije agakosora amakosa asanzwe ako kanya.','Bakora imyitozo, berekana umurimo wabo bagakosora amakosa.']]}}
};
const PLUS_STRATEGIES = {
 tps:{ name:'Think-Pair-Share', t:{en:'Think-Pair-Share: each learner thinks alone for 1 minute, discusses with a partner for 2 minutes, then shares with the class.',fr:'Réfléchir-Échanger-Partager : chaque élève réfléchit seul 1 minute, discute avec un camarade 2 minutes, puis partage avec la classe.',rw:'Tekereza-Ganira-Sangiza: buri munyeshuri atekereza wenyine umunota 1, akaganira na mugenzi we iminota 2, hanyuma agasangiza ishuri.'}},
 group:{ name:'Group work', t:{en:'Group work: groups of 4-5 share one task and one product.',fr:'Travail de groupe : des groupes de 4-5 élèves réalisent une tâche et un produit communs.',rw:'Gukorera mu matsinda: amatsinda y\'abanyeshuri 4-5 akora umurimo umwe n\'igikorwa kimwe.'}},
 role:{ name:'Role play', t:{en:'Role play: learners act out a short real-life situation linked to the lesson.',fr:'Jeu de rôle : les élèves jouent une courte situation de la vie réelle liée à la leçon.',rw:'Gukina uruhare: abanyeshuri bakina ikibazo gito cyo mu buzima gifitanye isano n\'isomo.'}},
 demo:{ name:'Demonstration', t:{en:'Demonstration: the teacher or a learner shows the process with real objects while others watch and describe it.',fr:'Démonstration : l\'enseignant(e) ou un élève montre le procédé avec des objets réels pendant que les autres observent et décrivent.',rw:'Kwerekana: umwarimu cyangwa umunyeshuri yerekana uko bikorwa akoresheje ibintu nyabyo abandi bareba bakabisobanura.'}},
 game:{ name:'Songs and games', t:{en:'Song or game: a short song, rhyme or game that practises the key content.',fr:'Chanson ou jeu : une courte chanson, comptine ou un jeu qui fait pratiquer le contenu clé.',rw:'Indirimbo cyangwa umukino: indirimbo ngufi, umukino cyangwa imivugo bifasha kwitoza ibikubiye mu isomo.'}},
 gallery:{ name:'Gallery walk', t:{en:'Gallery walk: groups display their work and learners walk round, read and leave one comment on each.',fr:'Marche en galerie : les groupes affichent leur travail et les élèves circulent, lisent et laissent un commentaire sur chaque production.',rw:'Gutambagira imirimo: amatsinda amanika imirimo yayo abanyeshuri bakazenguruka basoma bagasiga igitekerezo kuri buri wose.'}},
 qa:{ name:'Questioning', t:{en:'Questioning: the teacher uses open questions and waits for several answers before giving feedback.',fr:'Questionnement : l\'enseignant(e) pose des questions ouvertes et attend plusieurs réponses avant de commenter.',rw:'Kubaza ibibazo: umwarimu abaza ibibazo bifunguye agategereza ibisubizo byinshi mbere yo gutanga ibitekerezo.'}},
 peer:{ name:'Peer teaching', t:{en:'Peer teaching: a confident learner explains one step to a partner, then they swap.',fr:'Enseignement par les pairs : un élève à l\'aise explique une étape à un camarade, puis ils échangent.',rw:'Kwigishanya: umunyeshuri uzi neza asobanurira mugenzi we intambwe imwe, hanyuma bagahana.'}},
 story:{ name:'Storytelling', t:{en:'Storytelling: the teacher or learners tell a short story that carries the key idea.',fr:'Récit : l\'enseignant(e) ou les élèves racontent une courte histoire qui porte l\'idée clé.',rw:'Kuvuga inkuru: umwarimu cyangwa abanyeshuri bavuga inkuru ngufi irimo igitekerezo gikuru.'}},
 practical:{ name:'Practical / experiment', t:{en:'Practical work: learners use simple local materials to test or show the idea and record what they see.',fr:'Travaux pratiques : les élèves utilisent du matériel local simple pour tester ou montrer l\'idée et notent ce qu\'ils observent.',rw:'Imikoro y\'intoki: abanyeshuri bakoresha ibikoresho byoroshye byo mu gace kugerageza cyangwa kwerekana igitekerezo bakandika ibyo babonye.'}},
 field:{ name:'Outside / field task', t:{en:'Outdoor task: learners observe or measure in the school compound and report back.',fr:'Tâche en plein air : les élèves observent ou mesurent dans la cour de l\'école et font un compte rendu.',rw:'Umurimo hanze: abanyeshuri bareba cyangwa bapima mu kigo cy\'ishuri hanyuma bakabitangaza.'}}
};
