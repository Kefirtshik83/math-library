// Explicit package allowlist: no autoload, require, HTML URLs, CSS or arbitrary IDs.
window.MathJax={
  tex:{inlineMath:[['$','$'],['\\(','\\)']],displayMath:[['$$','$$'],['\\[','\\]']],
    packages:['base','ams','newcommand','noundefined'],tags:'ams',maxMacros:1000,maxBuffer:32768},
  options:{skipHtmlTags:['script','noscript','style','textarea','pre','code'],enableMenu:false},
  svg:{fontCache:'local',scale:1}
};
