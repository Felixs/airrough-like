import os
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s=open(os.path.join(D, 'shell.html')).read()
sim=open(os.path.join(D, 'sim.js')).read()
open(os.path.join(D, 'PROTOTYPE-run-loop.html'),'w').write(s.replace('/*__SIM__*/', sim))
