import math, sys
# centerline through points read off the brand guide render (px of the 1536x1024 PNG)
P = [(18,178),(70,158),(130,118),(190,64),(235,36),(262,31),(292,48),(325,95),(352,122),(378,128),(410,114),(440,101),(470,110),(498,125),(522,119),(546,109)]
def catmull(pts, n=24):
    out=[]
    for i in range(len(pts)-1):
        p0=pts[max(i-1,0)]; p1=pts[i]; p2=pts[i+1]; p3=pts[min(i+2,len(pts)-1)]
        for k in range(n):
            t=k/n; t2=t*t; t3=t2*t
            x=0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3)
            y=0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)
            out.append((x,y))
    out.append(pts[-1]); return out
C = catmull(P)
L=[0]
for a,b in zip(C,C[1:]): L.append(L[-1]+math.dist(a,b))
T=[l/L[-1] for l in L]
# half-width profile along the line (taper: thin tail, thick shoulder, thin end)
prof=[(0,7),(0.15,12),(0.33,25),(0.42,24),(0.55,17),(0.68,13),(0.82,10),(1.0,8)]
def hw(t):
    for (a,wa),(b,wb) in zip(prof,prof[1:]):
        if t<=b: u=(t-a)/(b-a); u=u*u*(3-2*u); return wa+(wb-wa)*u
    return prof[-1][1]
left=[];right=[]
for i,(x,y) in enumerate(C):
    a=C[max(i-1,0)]; b=C[min(i+1,len(C)-1)]
    dx,dy=b[0]-a[0],b[1]-a[1]; n=math.hypot(dx,dy) or 1
    nx,ny=-dy/n,dx/n; w=hw(T[i])
    left.append((x+nx*w,y+ny*w)); right.append((x-nx*w,y-ny*w))
# rounded caps: half circles at both ends
def cap(c,p_from,p_to,steps=10):
    ang0=math.atan2(p_from[1]-c[1],p_from[0]-c[0]); ang1=math.atan2(p_to[1]-c[1],p_to[0]-c[0])
    r=math.dist(c,p_from); d=ang1-ang0
    while d<=0: d+=2*math.pi
    if d>math.pi*1.5: d-=2*math.pi
    return [(c[0]+r*math.cos(ang0+d*k/steps), c[1]+r*math.sin(ang0+d*k/steps)) for k in range(1,steps)]
poly = left + right[::-1]
# viewBox around the mark
X0,Y0=0,0; W,H=580,200
pts=' '.join(f'{x-X0:.1f},{y-Y0:.1f}' for x,y in poly)
dot=P[-1]  # finish dot sits on the end of the centerline
ends=[(C[0],hw(0)),(C[-1],hw(1))]
def svg(route, ring, fill_dot, bg=None):
    b=f'<rect width="{W}" height="{H}" rx="40" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">{b}'
            f'<polygon points="{pts}" fill="{route}" stroke="{route}" stroke-width="1.5" stroke-linejoin="round"/>'
            + ''.join(f'<circle cx="{c[0]:.1f}" cy="{c[1]:.1f}" r="{r:.1f}" fill="{route}"/>' for c,r in ends) +
            f'<circle cx="{dot[0]}" cy="{dot[1]}" r="22" fill="{fill_dot}" stroke="{ring}" stroke-width="10"/></svg>')
open('symbol-colour.svg','w').write(svg('#FFD400','#111111','#FFD400'))
open('symbol-colour-dark.svg','w').write(svg('#FFD400','#F7F5EF','#FFD400'))
# app icon / favicon: yellow tile, black mark, centred with clear space
inner = svg('#111111','#111111','#111111').split('>',1)[1].rsplit('</svg>',1)[0]
open('icon.svg','w').write(
  f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#FFD400"/>'
  f'<g transform="translate(46 186) scale(0.72)">{inner}</g></svg>')
open('symbol-mono.svg','w').write(svg('#111111','#111111','#111111'))
open('symbol-reversed.svg','w').write(svg('#FFFFFF','#FFFFFF','#FFFFFF'))
print(len(poly))
