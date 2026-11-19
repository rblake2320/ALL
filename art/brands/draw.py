"""Generate eight original vector decal masters. No third-party artwork."""
from pathlib import Path

ROOT = Path(__file__).parent

def svg(content):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img">\n'
            + '\n'.join(line.rstrip() for line in content.split('\n')) + '\n</svg>\n')

def word(y, text, size, color, family='Georgia', weight='bold', spacing=3):
    return f'<text x="512" y="{y}" text-anchor="middle" fill="{color}" font-family="{family},serif" font-size="{size}" font-weight="{weight}" letter-spacing="{spacing}">{text}</text>'

ink, bone = '#1d1726', '#e8e0c8'
marks = {
 'mulch-master': f"""
 <path fill="#476448" stroke="{bone}" stroke-width="18" d="M512 90 808 214 772 600 512 735 252 600 216 214Z"/>
 <path fill="none" stroke="#b9d39a" stroke-width="13" d="M512 125 778 238 746 578 512 699 278 578 246 238Z"/>
 <path fill="#d6a55d" d="M340 500q18-100 166-130 134 28 177 130l-42 25H382Z"/>
 <circle cx="397" cy="527" r="40" fill="{ink}"/><circle cx="627" cy="527" r="40" fill="{ink}"/>
 <path d="M511 370V248m0 110q-111-6-122-105 99 1 122 105Zm0-35q27-93 119-100-9 100-119 100Z" fill="#b9d39a" stroke="{ink}" stroke-width="9" stroke-linejoin="round"/>
 <path fill="{ink}" d="M115 651h794l-42 147H157Z"/>{word(716,'MULCH',76,bone,'Georgia')}{word(778,'MASTER',67,'#d6a55d','Georgia')}
 {word(864,'THE LAWN AWAKENS',24,ink,'Arial','bold',5)}
 """,
 'grave-cola': f"""
 <path fill="#44344f" stroke="{bone}" stroke-width="15" d="M247 130h530v690H247z"/>
 <path fill="none" stroke="#ad9bbc" stroke-width="6" d="M269 152h486v646H269z"/>
 <path fill="#d9cfb8" d="M440 259h144l35 47v164q0 77-107 139-107-62-107-139V306Z"/>
 <path fill="#785978" d="M430 384q40-18 82 0t82 0v100q-2 56-82 98-80-42-82-98Z"/>
 <path d="M475 343h74m-64-23h54" stroke="{ink}" stroke-width="13" stroke-linecap="round"/>
 <circle cx="476" cy="430" r="11" fill="{bone}"/><circle cx="550" cy="462" r="8" fill="{bone}"/><circle cx="505" cy="501" r="6" fill="{bone}"/>
 {word(229,'GRAVE',75,bone,'Georgia')}{word(694,'COLA',96,bone,'Georgia')}{word(748,'A QUIET LITTLE FIZZ',21,'#d3bfd7','Arial','bold',4)}
 """,
 'volt-hearse': f"""
 <path fill="#2b2f3a" d="M95 343 214 212h668l-92 124 92 124H214Z"/><path fill="#7fe0ff" d="M156 340 236 255h553l-68 85 68 85H236Z"/>
 <path fill="{ink}" d="M413 323h174l-31 64 89-20-154 153 29-91-83 18Z"/>
 {word(608,'VOLT',143,ink,'Arial','bold',8)}{word(702,'HEARSE',91,'#486879','Arial','bold',8)}
 <path stroke="#486879" stroke-width="12" d="M194 757h636"/>{word(815,'THE LONG WAY HOME',25,ink,'Arial','bold',5)}
 """,
 'brain-bran': f"""
 <path fill="#d3a34e" stroke="{ink}" stroke-width="18" d="M253 194 512 95 771 194l56 553-315 139-315-139Z"/>
 <path fill="#f0d393" d="M274 221 512 133 750 221l47 505-285 122-285-122Z"/>
 <path d="M512 294c-39-52-111-25-107 27-54 3-72 70-31 101-19 51 28 91 68 73 28 39 72 26 70-8 0 34 44 47 70 8 40 18 87-22 68-73 41-31 23-98-31-101 4-52-68-79-107-27Z" fill="#c78170" stroke="{ink}" stroke-width="12"/>
 <path d="M512 300v174m-83-107q44 0 49 43m117-43q-44 0-49 43" fill="none" stroke="{ink}" stroke-width="9" stroke-linecap="round"/>
 {word(600,'BRAIN',88,ink,'Georgia')}{word(689,'BRAN',102,ink,'Georgia')}{word(755,'BREAKFAST FOR THINKERS',19,ink,'Arial','bold',3)}
 """,
 'rot-pop': f"""
 <path fill="#e2ad57" stroke="{ink}" stroke-width="16" stroke-linejoin="round" d="m512 82 69 88 104-42 20 110 112 8-29 108 95 62-73 84 60 99-108 39 5 113-111-8-47 101-90-67-90 67-47-101-111 8 5-113-108-39 60-99-73-84 95-62-29-108 112-8 20-110 104 42Z"/>
 <circle cx="512" cy="435" r="211" fill="#83637c"/><path fill="none" stroke="#efd9ad" stroke-width="12" stroke-dasharray="12 18" d="M512 253a182 182 0 1 0 0 364 182 182 0 1 0 0-364Z"/>
 <circle cx="454" cy="365" r="19" fill="#efd9ad"/><circle cx="570" cy="342" r="13" fill="#efd9ad"/><circle cx="560" cy="469" r="27" fill="#efd9ad"/>
 {word(425,'ROT',97,bone,'Arial','bold',5)}{word(530,'POP',107,bone,'Arial','bold',5)}
 <path fill="{ink}" d="M240 805q272 40 544 0v70q-272 40-544 0Z"/>{word(854,'CHEERFULLY FIZZY',25,bone,'Arial','bold',4)}
 """,
 'coffin-coffee': f"""
 <path fill="#68483b" stroke="{ink}" stroke-width="16" d="M373 107h278l93 119-46 459-186 123-186-123-46-459Z"/>
 <path fill="#d4ba92" d="M395 144h234l75 94-42 423-150 100-150-100-42-423Z"/>
 <path d="M394 437h211v81q0 87-105 87t-106-87Zm211 18h36q40 0 40 37t-40 37h-36" fill="#4c3932" stroke="{ink}" stroke-width="10"/>
 <path d="M457 399q-27-32 2-61m49 61q-27-32 2-61m49 61q-27-32 2-61" fill="none" stroke="#4c3932" stroke-width="13" stroke-linecap="round"/>
 {word(270,'COFFIN',70,ink,'Georgia')}{word(680,'COFFEE',72,ink,'Georgia')}{word(880,'WAKE UP AGAIN',26,ink,'Arial','bold',5)}
 """,
 'crypt-kicks': f"""
 <path fill="#34475a" stroke="{ink}" stroke-width="16" stroke-linejoin="round" d="M184 627q71-22 104-131l67-127 129 21 54 112q81 44 213 70 68 11 80 92v37q-307 63-647 0Z"/>
 <path fill="#a9dae0" d="m307 495 66-94 91 17 36 86 104 42-49 48-263-44Z"/>
 <path d="m394 450 68 14m-80 20 67 14m-80 20 67 14" stroke="{ink}" stroke-width="13" stroke-linecap="round"/>
 <path d="M194 654q320 55 626 0" fill="none" stroke="{bone}" stroke-width="16"/>
 <path d="M264 310 204 236m78 32-16-83m70 73 28-82" stroke="#ad799a" stroke-width="15" stroke-linecap="round"/>
 {word(808,'CRYPT',78,ink,'Arial','bold',5)}{word(900,'KICKS',94,'#34475a','Arial','bold',7)}
 """,
 'necro-tech': f"""
 <path fill="#323847" stroke="#7fe0ff" stroke-width="14" d="M198 239 299 138h426l101 101v339L725 679H299L198 578Z"/>
 <path fill="{ink}" d="M247 255 317 185h390l70 70v306l-70 70H317l-70-70Z"/>
 <path d="M365 510V302l294 208V302" fill="none" stroke="#7fe0ff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
 <circle cx="365" cy="302" r="18" fill="#ffb35a"/><circle cx="659" cy="510" r="18" fill="#ffb35a"/>
 {word(774,'NECRO',94,ink,'Arial','bold',7)}{word(858,'TECH',76,'#465c6b','Arial','bold',9)}
 """
}
for name, body in marks.items():
    (ROOT / (name + '.svg')).write_text(svg(body), encoding='utf-8')
print(f'wrote {len(marks)} vector masters')
