import re, json, pathlib

text = pathlib.Path('cards-page.html').read_text(errors='ignore')
m = re.search(r'id="__NEXT_DATA__"[^>]*>(.*?)</script>', text, re.S)
print('found:', m is not None)

if m:
    data = json.loads(m.group(1))
    print('data keys:', list(data.keys()))
    
    props = data.get('props', {})
    pp = props.get('pageProps', {}) if props else data.get('pageProps', {})
    
    print('pageProps keys:', list(pp.keys())[:50])
    print()
    
    # Check for cardData
    if 'cardData' in pp:
        cd = pp['cardData']
        print('cardData type:', type(cd))
        if isinstance(cd, dict):
            print('cardData keys (sets):', list(cd.keys())[:20])
        print()
    
    # Check for expansions
    if 'expansions' in pp:
        exp = pp['expansions']
        print('expansions type:', type(exp))
        print('expansions count:', len(exp) if isinstance(exp, list) else None)
        if isinstance(exp, list) and exp:
            print('first expansion:', exp[0])
