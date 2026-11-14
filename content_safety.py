"""Limits and final HTML allowlist. Authored content is never executable code."""
import re
import nh3

MAX_BYTES = 262144
ID = re.compile(r'[a-z0-9][a-z0-9-]{0,79}\Z')
BLOCK_ID = re.compile(r'[A-Za-z0-9_-]{1,64}\Z')
BAD = {'__proto__', 'prototype', 'constructor', 'draft'}
CLASSES = {'theorem', 'lemma', 'proposition', 'corollary', 'definition', 'statement', 'exercise', 'example', 'proof', 'remark', 'insight', 'math', 'inline', 'display'}
IMAGE_PATH = re.compile(r'\.\./assets/[A-Za-z0-9][A-Za-z0-9_-]{0,99}\.(?:svg|png|jpg|jpeg|webp)\Z')

def slug(value):
    if not isinstance(value, str) or not ID.fullmatch(value) or value in BAD:
        raise ValueError('Invalid identifier')
    return value

def validate_blocks(items):
    if not isinstance(items, list) or not 1 <= len(items) <= 1000:
        raise ValueError('Invalid blocks')
    seen = set()
    for b in items:
        if set(b) != {'id', 'source'} or not BLOCK_ID.fullmatch(b['id']) or b['id'] in BAD or b['id'] in seen:
            raise ValueError('Invalid block identifier')
        seen.add(b['id'])
        if not isinstance(b['source'], str) or not b['source'].strip() or len(b['source']) > 65536:
            raise ValueError('Invalid block source')
        if re.search(r'<!--\s*ml:(block|collection):', b['source'], re.I):
            raise ValueError('Embedded structural marker')

def validate_collections(items):
    if not isinstance(items, list) or not 1 <= len(items) <= 200:
        raise ValueError('Invalid collections')
    by_id = {}
    for c in items:
        if not isinstance(c, dict) or set(c) != {'id', 'title', 'description', 'parent', 'order'}:
            raise ValueError('Invalid collection fields')
        slug(c['id'])
        if c['id'] in by_id:
            raise ValueError('Duplicate collection')
        if not isinstance(c['title'], str) or not c['title'].strip() or len(c['title']) > 200:
            raise ValueError('Invalid collection title')
        if not isinstance(c['description'], str) or len(c['description']) > 2000:
            raise ValueError('Invalid description')
        if type(c['order']) is not int or not 0 <= c['order'] <= 100000:
            raise ValueError('Invalid collection order')
        if c['parent'] is not None:
            slug(c['parent'])
        by_id[c['id']] = c
    for c in items:
        seen, parent = {c['id']}, c['parent']
        while parent is not None:
            if parent not in by_id or parent in seen or len(seen) > 12:
                raise ValueError('Invalid collection hierarchy')
            seen.add(parent)
            parent = by_id[parent]['parent']

def attributes(tag, name, value):
    if name == 'class':
        return ' '.join(x for x in value.split() if x in CLASSES) or None
    if tag == 'img' and name == 'src':
        return value if IMAGE_PATH.fullmatch(value) else None
    if name == 'href':
        if re.search(r'[\x00-\x20\x7f\\]', value) or value.startswith('//'):
            return None
        if value.startswith('#') and not value.startswith(('#block-', '#content-')):
            return '#content-' + value[1:]
    if name == 'id':
        return 'content-' + value
    return value

CLEANER = nh3.Cleaner(
    tags={'p','div','span','a','strong','em','b','i','code','pre','blockquote','ul','ol','li',
          'h1','h2','h3','h4','h5','h6','hr','br','sup','sub','del','table','thead','tbody','tr','th','td','caption','img'},
    attributes={'*': {'class'}, 'a': {'href', 'title'}, 'img': {'src', 'alt', 'title'}, 'ol': {'start'},
                **{f'h{i}': {'id'} for i in range(1,7)}},
    attribute_filter=attributes,
    url_schemes={'http','https','mailto'},
    clean_content_tags={'script','style','iframe','object','svg','math','template'},
    link_rel='noopener noreferrer', strip_comments=True,
)

def sanitize(markup):
    return CLEANER.clean(markup)
