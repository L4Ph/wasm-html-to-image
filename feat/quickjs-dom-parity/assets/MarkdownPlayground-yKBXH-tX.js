import{n as e,t}from"./rolldown-runtime-WkwZ5CU-.js";import{d as n,r,s as i,t as a}from"./jsx-runtime-DSoKjkUC.js";import{t as o}from"./preload-helper-CRzLMJPS.js";var s=e(n(),1);function c(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var l=c();function u(e){l=e}var d={exec:()=>null};function f(e){let t=[];return n=>{let r=Math.max(0,Math.min(3,n-1)),i=t[r];return i||(i=e(r),t[r]=i),i}}function p(e,t=``){let n=typeof e==`string`?e:e.source,r={replace:(e,t)=>{let i=typeof t==`string`?t:t.source;return i=i.replace(h.caret,`$1`),n=n.replace(e,i),r},getRegex:()=>new RegExp(n,t)};return r}var m=((e=``)=>{try{return!!RegExp(`(?<=1)(?<!1)`+e)}catch{return!1}})(),h={codeRemoveIndent:/^(?: {0,3}\t| {1,4})/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,endingSpaceTabChar:/[ \t]$/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,leadingSpaceTab:/^[ \t]+/,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,blockquoteMarkerWhitespace:/^( {0,3}>)([ \t]+)/gm,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\][ \t]+\S/,listReplaceTask:/^\[[ xX]\][ \t]+/,listTaskCheckbox:/\[[ xX]\]/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,numericCharacterReference:/&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/,numericCharacterReferenceOrAmpersand:/&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:e=>RegExp(`^( {0,3}${e})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:f(e=>RegExp(`^ {0,${e}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)),hrRegex:f(e=>RegExp(`^ {0,${e}}((?:-[ 	]*){3,}|(?:_[ 	]*){3,}|(?:\\*[ 	]*){3,})(?:\\n+|$)`)),fencesBeginRegex:f(e=>RegExp(`^ {0,${e}}(?:\`\`\`|~~~)`)),headingBeginRegex:f(e=>RegExp(`^ {0,${e}}#{1,6}(?:\\s|$)`)),pedanticHeadingBeginRegex:f(e=>RegExp(`^ {0,${e}}#`)),htmlBeginRegex:f(e=>RegExp(`^ {0,${e}}(?:</?(?:${A})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`,`i`)),blockquoteBeginRegex:f(e=>RegExp(`^ {0,${e}}>`))},g=/^(?:[ \t]*(?:\n|$))+/,_=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,v=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/,y=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,b=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,x=/ {0,3}(?:[*+-]|\d{1,9}[.)])/,S=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)/,C=p(S).replace(/bull/g,x).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}(?:\s|$)/).replace(/hr/g,/ {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,``).getRegex(),w=p(S).replace(/bull/g,x).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}(?:\s|$)/).replace(/hr/g,/ {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),T=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/,E=/^[^\n]+/,D=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/,O=p(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace(`label`,D).replace(`title`,/(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/).getRegex(),k=p(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g,x).getRegex(),A=`address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul`,j=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,M=p(`^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))`,`i`).replace(`comment`,j).replace(`tag`,A).replace(`attribute`,/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),N=e=>p(T).replace(`hr`,y).replace(`heading`,` {0,3}#{1,6}(?:\\s|$)`).replace(`|lheading`,``).replace(`|table`,``).replace(`blockquote`,` {0,3}>`).replace(`fences`," {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace(`list`,e).replace(`html`,` {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`).replace(`tag`,A).getRegex(),P=N(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/),F=N(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/),I={blockquote:p(/^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(paragraph)|[^\n]*)(?:\n|$))+/).replace(`paragraph`,F).getRegex(),code:_,def:O,fences:v,heading:b,hr:y,html:M,lheading:C,list:k,newline:g,paragraph:P,table:d,text:E},L=p(`^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)`).replace(`hr`,y).replace(`heading`,` {0,3}#{1,6}(?:\\s|$)`).replace(`blockquote`,` {0,3}>`).replace(`code`,`(?: {4}| {0,3}	)[^\\n]`).replace(`fences`," {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace(`list`,` {0,3}(?:[*+-]|1[.)])[ \\t]`).replace(`html`,` {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`).replace(`tag`,A).getRegex(),ee={...I,lheading:w,table:L,paragraph:p(T).replace(`hr`,y).replace(`heading`,` {0,3}#{1,6}(?:\\s|$)`).replace(`|lheading`,``).replace(`table`,L).replace(`blockquote`,` {0,3}>`).replace(`fences`," {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace(`list`,` {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]`).replace(`html`,` {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`).replace(`tag`,A).getRegex()},te={...I,html:p(`^ *(?:comment(?: *\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1>(?: *\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?>(?: *\\n{2,}|\\s*$))`).replace(`comment`,j).replace(/tag/g,`(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b`).getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:d,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:p(T).replace(`hr`,y).replace(`heading`,` *#{1,6} *[^
]`).replace(`lheading`,C).replace(`|table`,``).replace(`blockquote`,` {0,3}>`).replace(`|fences`,``).replace(`|list`,``).replace(`|html`,``).replace(`|tag`,``).getRegex()},ne=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,re=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,ie=/^( {2,}|\\)\n(?!\s*$)[ \t]*/,ae=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,R=/[\p{P}\p{S}]/u,oe=/[\s\p{P}\p{S}]/u,se=/[^\s\p{P}\p{S}]/u,ce=p(/^((?![*_])punctSpace)/,`u`).replace(/punctSpace/g,oe).getRegex(),le=/[\p{Pi}\p{Ps}"']/u,ue=/(?!~)[\p{P}\p{S}]/u,de=/(?!~)[\s\p{P}\p{S}]/u,fe=/(?:[^\s\p{P}\p{S}]|~)/u,pe=p(/link|precode-code|html/,`g`).replace(`link`,/\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace(`precode-`,m?"(?<!`)()":"(^^|[^`])").replace(`code`,/(?<b>`+)[^`]+\k<b>(?!`)/).replace(`html`,/<(?! )[^<>]*?>/).getRegex(),me=/^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/,z=p(me,`u`).replace(/punct/g,R).getRegex(),he=p(me,`u`).replace(/punct/g,ue).getRegex(),ge=p(/^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/,`u`).replace(/openQuote/g,le).replace(/punct/g,R).getRegex(),_e=`^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)`,ve=p(_e,`gu`).replace(/notPunctSpace/g,se).replace(/punctSpace/g,oe).replace(/punct/g,R).getRegex(),ye=p(_e,`gu`).replace(/notPunctSpace/g,fe).replace(/punctSpace/g,de).replace(/punct/g,ue).getRegex(),be=p(`^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)`,`gu`).replace(/notPunctSpace/g,se).replace(/punctSpace/g,oe).replace(/punct/g,R).getRegex(),xe=p(`^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)`,`gu`).replace(/notPunctSpace/g,se).replace(/punctSpace/g,oe).replace(/punct/g,R).getRegex(),Se=p(`^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)`,`gu`).replace(/notPunctSpace/g,se).replace(/punctSpace/g,oe).replace(/punct/g,R).getRegex(),Ce=p(/^~~?(?:((?!~)punct)|[^\s~])/,`u`).replace(/punct/g,R).getRegex(),we=p(`^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)`,`gu`).replace(/notPunctSpace/g,se).replace(/punctSpace/g,oe).replace(/punct/g,R).getRegex(),Te=p(/\\(punct)/,`gu`).replace(/punct/g,R).getRegex(),Ee=p(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/,`gu`).replace(/punct/g,R).getRegex(),De=p(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace(`scheme`,/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace(`email`,/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),Oe=p(j).replace(`(?:-->|$)`,`-->`).getRegex(),ke=p(`^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>`).replace(`comment`,Oe).replace(`attribute`,/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),Ae=/\[(?:\\[\s\S]|[^\[\]\\])*\]/,je=p(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace(`brackets`,Ae).getRegex(),Me=p(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/).replace(`label`,je).replace(`href`,/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace(`title`,/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/).getRegex(),Ne=p(/^!?\[(label)\]\[(ref)\]/).replace(`label`,je).replace(`ref`,D).getRegex(),Pe=p(/^!?\[(ref)\](?:\[\])?/).replace(`ref`,D).getRegex(),Fe=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/,Ie=p(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace(`brackets`,Ae).getRegex(),Le=p(`reflink|nolink(?!\\()`,`g`).replace(`reflink`,p(/^!?\[(label)\]\[(ref)\]/).replace(`label`,Ie).replace(`ref`,Fe).getRegex()).replace(`nolink`,p(/^!?\[(ref)\](?:\[\])?/).replace(`ref`,Fe).getRegex()).getRegex(),Re=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,ze=p(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).replace(/email/g,/[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(),Be={_backpedal:d,anyPunctuation:Te,anyPunctuationOutsideCode:Ee,autolink:De,blockSkip:pe,br:ie,code:re,del:d,delLDelim:d,delRDelim:d,emStrongLDelim:z,emStrongRDelimAst:ve,emStrongRDelimUnd:xe,escape:ne,link:Me,nolink:Pe,punctuation:ce,reflink:Ne,reflinkSearch:Le,tag:ke,text:ae,url:d},Ve={...Be,emStrongLDelim:ge,emStrongRDelimAst:be,emStrongRDelimUnd:Se,link:p(/^!?\[(label)\]\((.*?)\)/).replace(`label`,je).getRegex(),reflink:p(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace(`label`,je).getRegex()},He={...Be,emStrongRDelimAst:ye,emStrongLDelim:he,delLDelim:Ce,delRDelim:we,url:p(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace(`emailProtocol`,ze).replace(`protocol`,Re).replace(`email`,/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,text:p(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|wwwStart|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/).replace(`protocol`,Re).replace(/emailProtocol/g,/(?:mailto|xmpp):/).replace(`wwwStart`,m?`(?<![^\\s*_~(])www\\.`:`www\\.`).getRegex()},Ue={...He,br:p(ie).replace(`{2,}`,`*`).getRegex(),text:p(He.text).replace(`\\b_`,`\\b_| {2,}\\n`).replace(/\{2,\}/g,`*`).getRegex()},We={normal:I,gfm:ee,pedantic:te},Ge={normal:Be,gfm:He,breaks:Ue,pedantic:Ve},Ke={"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&#39;`},qe=e=>Ke[e];function B(e,t){if(t){if(h.escapeTest.test(e))return e.replace(h.escapeReplace,qe)}else if(h.escapeTestNoEncode.test(e))return e.replace(h.escapeReplaceNoEncode,qe);return e}function Je(e){return h.numericCharacterReference.test(e)?e.replace(h.numericCharacterReferenceOrAmpersand,(e,t,n)=>{if(t===void 0&&n===void 0)return`&amp;`;let r=t===void 0?Number.parseInt(n,16):Number.parseInt(t,10);return r===0||r>1114111||r>=55296&&r<=57343?`�`:r===38?`&amp;`:String.fromCodePoint(r)}):e}function Ye(e){try{e=encodeURI(e).replace(h.percentDecode,`%`)}catch{return null}return e}function Xe(e,t){let n=e.replace(h.findPipe,(e,t,n)=>{let r=!1,i=t;for(;--i>=0&&n[i]===`\\`;)r=!r;return r?`|`:` |`}).split(h.splitPipe),r=0;if(n[0].trim()||n.shift(),n.length>0&&!n.at(-1)?.trim()&&n.pop(),t){if(n.length>t)n.splice(t);else for(;n.length<t;)n.push(``)}for(;r<n.length;r++)n[r]=n[r].trim().replace(h.slashPipe,`|`);return n}function V(e,t,n){let r=e.length;if(r===0)return``;let i=0;for(;i<r;){let a=e.charAt(r-i-1);if(a===t&&!n)i++;else if(a!==t&&n)i++;else break}return e.slice(0,r-i)}function Ze(e){let t=e.split(`
`),n=t.length-1;for(;n>=0&&h.blankLine.test(t[n]);)n--;return t.length-n<=2?e:t.slice(0,n+1).join(`
`)}function Qe(e){return e.trim().replace(h.multipleSpaceGlobal,` `).toLowerCase().toUpperCase().toLowerCase()}function $e(e,t){if(e.indexOf(t[0])===-1&&e.indexOf(t[1])===-1)return-1;let n=0;for(let r=0;r<e.length;r++)if(e[r]===`\\`)r++;else if(e[r]===t[0])n++;else if(e[r]===t[1]&&(n--,n<0))return r;return n>0?-2:-1}var et=new WeakMap;function tt(e){let t={"*":-1,_:-1},n=-1,r=e.length;for(let i=0;i<r;i++){let a=e[i];if(a!==`*`&&a!==`_`&&a!==`~`)continue;let o=i===0?`
`:e[i-1],s=i+1;for(;s<r&&e[s]===a;)s++;o!==` `&&o!==`	`&&o!==`
`&&o!==`\r`&&o!==`\f`&&(a===`~`?n=i:t[a]=i),i=s-1}return{maskedSrc:e,lastPossibleEmStrongCloserIndex:t,lastPossibleDelCloserIndex:n}}function nt(e,t){let n=tt(t),r=et.get(e);r?r.push(n):et.set(e,[n])}function rt(e){let t=et.get(e);t&&(t.pop(),t.length===0&&et.delete(e))}function it(e,t,n){let r=et.get(e)?.at(-1);return r&&r.maskedSrc===t?r.lastPossibleEmStrongCloserIndex[n]:tt(t).lastPossibleEmStrongCloserIndex[n]}function at(e,t){let n=et.get(e)?.at(-1);return n&&n.maskedSrc===t?n.lastPossibleDelCloserIndex:tt(t).lastPossibleDelCloserIndex}function ot(e,t=0){let n=t,r=``;for(let t of e)if(t===`	`){let e=4-n%4;r+=` `.repeat(e),n+=e}else r+=t,n++;return r}function st(e,t,n,r,i){let a=t.href,o=t.title||null,s=e[1].replace(i.other.outputLinkReplace,`$1`),c=e[0].charAt(0)===`!`,l=r.state.inLink,u=r.state.linkEmitted,d=r.state.inRawBlock;r.state.inLink=!0,r.state.linkEmitted=!1;let f=r.inlineTokens(s),p=r.state.linkEmitted;if(r.state.linkEmitted=u,r.state.inLink=l,!c){if(p){r.state.inRawBlock=d;return}r.state.linkEmitted=!0}return{type:c?`image`:`link`,raw:n,href:a,title:o,text:s,tokens:f}}function ct(e,t,n){let r=e.match(n.other.indentCodeCompensation);if(r===null)return t;let i=r[1];return t.split(`
`).map(e=>{let t=e.match(n.other.beginningSpace);if(t===null)return e;let[r]=t;return e.slice(Math.min(r.length,i.length))}).join(`
`)}function lt(e,t,n,r){if(!t.includes(`<`))return!1;for(let i=0;i<t.length;i++){if(t[i]===`\\`){i++;continue}if(t[i]==="`"){let e=r.inline.code.exec(t.slice(i));if(e){i+=e[0].length-1;continue}}if(t[i]!==`<`)continue;let a=e.slice(n+i),o=r.inline.tag.exec(a)||r.inline.autolink.exec(a);if(o){if(o[0].length>t.length-i)return!0;i+=o[0].length-1}}return!1}var ut=class{options;rules;lexer;constructor(e){this.options=e||l}space(e){let t=this.rules.block.newline.exec(e);if(t&&t[0].length>0)return{type:`space`,raw:t[0]}}code(e){let t=this.rules.block.code.exec(e);if(t){let e=this.options.pedantic?t[0]:Ze(t[0]);return{type:`code`,raw:e,codeBlockStyle:`indented`,text:e.replace(this.rules.other.codeRemoveIndent,``)}}}fences(e){let t=this.rules.block.fences.exec(e);if(t){let e=t[0],n=ct(e,t[3]||``,this.rules);return{type:`code`,raw:e,lang:t[2]?t[2].trim().replace(this.rules.inline.anyPunctuation,`$1`):t[2],text:n}}}heading(e){let t=this.rules.block.heading.exec(e);if(t){let e=t[2].trim();if(this.rules.other.endingHash.test(e)){let t=V(e,`#`);(this.options.pedantic||!t||this.rules.other.endingSpaceTabChar.test(t))&&(e=t.trim())}return{type:`heading`,raw:V(t[0],`
`),depth:t[1].length,text:e,tokens:this.lexer.inline(e)}}}hr(e){let t=this.rules.block.hr.exec(e);if(t)return{type:`hr`,raw:V(t[0],`
`)}}blockquote(e){let t=this.rules.block.blockquote.exec(e);if(t){let e=V(t[0],`
`).split(`
`),n=``,r=``,i=[];for(;e.length>0;){let t=!1,a=[],o=0;for(;o<e.length;o++)if(this.rules.other.blockquoteStart.test(e[o]))a.push(e[o]),t=!0;else if(!t)a.push(e[o]);else break;e=e.slice(o);let s=a.join(`
`),c=s.replace(this.rules.other.blockquoteMarkerWhitespace,(e,t,n)=>t+ot(n,t.length)).replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,``);n=n?`${n}
${s}`:s,r=r?`${r}
${c}`:c;let l=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(c,i,!0),this.lexer.state.top=l,e.length===0)break;let u=i.at(-1);if(u?.type===`code`||u?.type===`heading`||u?.type===`hr`||u?.type===`html`||u?.type===`table`)break;if(u?.type===`blockquote`){let t=u,a=e.join(`
`),o=t.raw+`
`+a.replace(this.rules.other.blockquoteSetextReplace2,``),s=this.blockquote(o);i[i.length-1]=s;let c=o.substring(s.raw.length).replace(/^\n/,``),l=c?c.split(`
`).length:0,d=l?e.slice(0,-l):e;if(d.length>0&&(n=`${n}
${d.join(`
`)}`),r=r.substring(0,r.length-t.text.length)+s.text,e=e.slice(d.length),e.length>0&&this.rules.other.blockquoteStart.test(e[0]))continue;break}if(u?.type===`list`){let t=u,a=t.raw+`
`+e.join(`
`),o=this.list(a);i[i.length-1]=o;let s=o.raw.length>t.raw.length?a.slice(t.raw.length+1,o.raw.length).split(`
`).length:0;if(s>0){let t=e.slice(0,s).join(`
`);n=`${n}
${t}`,r=`${r}
${t}`}e=e.slice(s)}}return{type:`blockquote`,raw:n,tokens:i,text:r}}}list(e){let t=this.rules.block.list.exec(e);if(t){let n=e,r=()=>n.length-e.length,i=t[1].trim(),a=i.length>1,o={type:`list`,raw:``,ordered:a,start:a?+i.slice(0,-1):``,loose:!1,items:[]};i=a?`\\d{1,9}\\${i.slice(-1)}`:`\\${i}`,this.options.pedantic&&(i=a?i:`[*+-]`);let s=this.rules.other.listItemRegex(i),c=!1;for(;e;){let i=!1,a=``;if(!(t=s.exec(e))||this.rules.block.hr.test(e))break;let l=r();e=e.substring(t[0].length);let u=t[2].split(`
`,1)[0],d=t[1].length,f=this.options.pedantic?ot(u,d):u.replace(this.rules.other.leadingSpaceTab,e=>ot(e,d)),p=e.split(`
`,1)[0],m=!f.trim(),h=0;if(this.options.pedantic?(h=2,a=f.trimStart()):m?h=d+1:(h=f.search(this.rules.other.nonSpaceChar),h=h>4?1:h,a=f.slice(h),h+=d),m&&this.rules.other.blankLine.test(p)&&(e=e.substring(p.length+1),i=!0),!i){let t=this.rules.other.nextBulletRegex(h),n=this.rules.other.hrRegex(h),r=this.rules.other.fencesBeginRegex(h),i=this.options.pedantic?this.rules.other.pedanticHeadingBeginRegex(h):this.rules.other.headingBeginRegex(h),o=this.rules.other.htmlBeginRegex(h),s=this.rules.other.blockquoteBeginRegex(h);for(;e;){let c=e.split(`
`,1)[0],l;if(p=c,this.options.pedantic?(p=p.replace(this.rules.other.listReplaceNesting,`  `),l=p):l=p.replace(this.rules.other.leadingSpaceTab,e=>ot(e)),r.test(p)||i.test(p)||o.test(p)||s.test(p)||t.test(p)||n.test(p))break;if(l.search(this.rules.other.nonSpaceChar)>=h||!p.trim())a+=`
`+l.slice(h);else{if(m||f.replace(this.rules.other.tabCharGlobal,`    `).search(this.rules.other.nonSpaceChar)>=4||r.test(f)||i.test(f)||o.test(f)||n.test(f))break;let e=!this.options.pedantic&&/^ {0,3}(?:=+|-+) *$/.test(p)&&this.rules.block.lheading.test(`${f}
${p}`)?`    ${l.replace(/^ {0,3}/,``)}`:p;a+=`
`+e}m=!p.trim(),e=e.substring(c.length+1),f=l.slice(h)}}let g=n.slice(l,r());o.loose||(c?o.loose=!0:this.rules.other.doubleBlankLine.test(g)&&(c=!0)),o.items.push({type:`list_item`,raw:g,task:!!this.options.gfm&&this.rules.other.listIsTask.test(a),loose:!1,text:a,tokens:[]})}let l=o.items.at(-1);if(l)l.raw=l.raw.trimEnd(),l.text=l.text.trimEnd();else return;o.raw=n.slice(0,r()).trimEnd();for(let e of o.items)if(this.lexer.state.top=!1,e.tokens=this.lexer.blockTokens(e.text,[]),!o.loose){let t=e.tokens.filter(e=>e.type===`space`);o.loose=t.length>0&&t.some(e=>this.rules.other.anyLine.test(e.raw))}for(let e of o.items){let t=e.tokens[0];if(e.task&&(t?.type===`text`||t?.type===`paragraph`)){e.text=e.text.replace(this.rules.other.listReplaceTask,``),t.raw=t.raw.replace(this.rules.other.listReplaceTask,``),t.text=t.text.replace(this.rules.other.listReplaceTask,``);for(let e=this.lexer.inlineQueue.length-1;e>=0;e--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[e].src)){this.lexer.inlineQueue[e].src=this.lexer.inlineQueue[e].src.replace(this.rules.other.listReplaceTask,``);break}let n=this.rules.other.listTaskCheckbox.exec(e.raw);if(n){let t={type:`checkbox`,raw:n[0]+` `,checked:n[0]!==`[ ]`};e.checked=t.checked,o.loose?e.tokens[0]&&[`paragraph`,`text`].includes(e.tokens[0].type)&&`tokens`in e.tokens[0]&&e.tokens[0].tokens?(e.tokens[0].raw=t.raw+e.tokens[0].raw,e.tokens[0].text=t.raw+e.tokens[0].text,e.tokens[0].tokens.unshift(t)):e.tokens.unshift({type:`paragraph`,raw:t.raw,text:t.raw,tokens:[t]}):e.tokens.unshift(t)}}else e.task&&=!1}if(o.loose)for(let e of o.items){e.loose=!0;for(let t of e.tokens)t.type===`text`&&(t.type=`paragraph`)}return o}}html(e){let t=this.rules.block.html.exec(e);if(t){let e=Ze(t[0]);return{type:`html`,block:!0,raw:e,pre:t[1]===`pre`||t[1]===`script`||t[1]===`style`,text:e}}}def(e){let t=this.rules.block.def.exec(e);if(t){if(!this.rules.other.startAngleBracket.test(t[2])&&$e(t[2],`()`)!==-1)return;let e=Qe(t[1]),n=t[2]?t[2].replace(this.rules.other.hrefBrackets,`$1`).replace(this.rules.inline.anyPunctuation,`$1`):``,r=t[3]?t[3].substring(1,t[3].length-1).replace(this.rules.inline.anyPunctuation,`$1`):t[3];return{type:`def`,tag:e,raw:V(t[0],`
`),href:n,title:r}}}table(e){let t=this.rules.block.table.exec(e);if(!t||!this.rules.other.tableDelimiter.test(t[2]))return;let n=Xe(t[1]),r=t[2].replace(this.rules.other.tableAlignChars,``).split(`|`),i=t[3]?.trim()?t[3].replace(this.rules.other.tableRowBlankLine,``).split(`
`):[],a={type:`table`,raw:V(t[0],`
`),header:[],align:[],rows:[]};if(n.length===r.length){for(let e of r)this.rules.other.tableAlignRight.test(e)?a.align.push(`right`):this.rules.other.tableAlignCenter.test(e)?a.align.push(`center`):this.rules.other.tableAlignLeft.test(e)?a.align.push(`left`):a.align.push(null);for(let e=0;e<n.length;e++)a.header.push({text:n[e],tokens:this.lexer.inline(n[e]),header:!0,align:a.align[e]});for(let e of i)a.rows.push(Xe(e,a.header.length).map((e,t)=>({text:e,tokens:this.lexer.inline(e),header:!1,align:a.align[t]})));return a}}lheading(e){let t=this.rules.block.lheading.exec(e);if(t){let e=t[1].trim();return{type:`heading`,raw:V(t[0],`
`),depth:t[2].charAt(0)===`=`?1:2,text:e,tokens:this.lexer.inline(e)}}}paragraph(e){let t=this.rules.block.paragraph.exec(e);if(t){let e=t[1].charAt(t[1].length-1)===`
`?t[1].slice(0,-1):t[1];return{type:`paragraph`,raw:t[0],text:e,tokens:this.lexer.inline(e)}}}text(e){let t=this.rules.block.text.exec(e);if(t)return{type:`text`,raw:t[0],text:t[0],tokens:this.lexer.inline(t[0])}}escape(e){let t=this.rules.inline.escape.exec(e);if(t)return{type:`escape`,raw:t[0],text:t[1]}}tag(e){let t=this.rules.inline.tag.exec(e);if(t)return!this.lexer.state.inLink&&this.rules.other.startATag.test(t[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(t[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(t[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(t[0])&&(this.lexer.state.inRawBlock=!1),{type:`html`,raw:t[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:t[0]}}link(e){if(this.lexer.state.linkParenPossible===!1)return;let t=this.rules.inline.link.exec(e);if(t){let n=t[0].charAt(0)===`!`?2:1;if(!this.options.pedantic&&lt(e,t[1],n,this.rules))return;let r=t[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(r)){if(!this.rules.other.endAngleBracket.test(r))return;let e=V(r.slice(0,-1),`\\`);if((r.length-e.length)%2==0)return}else{let e=$e(t[2],`()`);if(e===-2)return;if(e>-1){let n=(t[0].indexOf(`!`)===0?5:4)+t[1].length+e;t[2]=t[2].substring(0,e),t[0]=t[0].substring(0,n).trim(),t[3]=``}}let i=V(t[0].slice(0,-1),`\\`);if((t[0].length-i.length)%2==0)return;let a=t[2],o=``;if(this.options.pedantic){let e=this.rules.other.pedanticHrefTitle.exec(a);e&&(a=e[1],o=e[3])}else o=t[3]?t[3].slice(1,-1):``;return a=a.trim(),this.rules.other.startAngleBracket.test(a)&&(a=this.options.pedantic&&!this.rules.other.endAngleBracket.test(r)?a.slice(1):a.slice(1,-1)),st(t,{href:a&&a.replace(this.rules.inline.anyPunctuation,`$1`),title:o&&o.replace(this.rules.inline.anyPunctuation,`$1`)},t[0],this.lexer,this.rules)}}reflink(e,t){let n;if((n=this.rules.inline.reflink.exec(e))||(n=this.rules.inline.nolink.exec(e))){let r=n[0].charAt(0)===`!`?2:1;if(!this.options.pedantic&&lt(e,n[1],r,this.rules))return;let i=t[Qe(n[2]||n[1])];if(!i){let e=n[0].charAt(0);return{type:`text`,raw:e,text:e}}return st(n,i,n[0],this.lexer,this.rules)}}emStrong(e,t,n=``){let r=this.rules.inline.emStrongLDelim.exec(e);if(!r||!r[1]&&!r[2]&&!r[3]&&!r[4])return;let i=r[0][0],a=n===i,o=t.length-e.length,s=o;for(;!this.options.pedantic&&s>0&&t[s-1]===i;)s--;let c=[...t.slice(Math.max(0,s-2),s)].at(-1)??``,l=c===`*`||c===`_`||!!this.rules.inline.punctuation.exec(c);s<o&&(n=c);let u=s<o?l:!!this.rules.inline.punctuation.exec(n);if(r[4]&&n.match(this.rules.other.unicodeAlphaNumeric))return;let d=r[1]||r[3]||``;if(!d||!n||u){let n=[...r[0]].length-1,u,f,p=n,m=0,h=o-s+n,g=!this.options.pedantic&&!!c.trim()&&(!!d||i===`*`&&!l);if(i!==`*`&&i!==`_`)return;let _=i===`*`?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd,v=it(this,t,i),y=t.length-e.length+n;if(v<y)return;t=t.slice(-1*e.length+n);let b=v-y;for(_.lastIndex=0;(r=_.exec(t))!==null&&!(r.index>b);){if(u=r[1]||r[2]||r[3]||r[4]||r[5]||r[6],!u)continue;if(f=[...u].length,r[3]||r[4]){p+=f;continue}if(r[5]||r[6]||g){if(a&&(r[5]||r[6]))break;if(h%3&&!((h+f)%3)){m+=f;continue}}if(p-=f,p>0)continue;f=Math.min(f,f+p+m);let t=[...r[0]][0].length,i=e.slice(0,n+r.index+t+f);if(Math.min(n,f)%2){let e=i.slice(1,-1);return{type:`em`,raw:i,text:e,tokens:this.lexer.inlineTokens(e)}}let o=i.slice(2,-2);return{type:`strong`,raw:i,text:o,tokens:this.lexer.inlineTokens(o)}}}}codespan(e){let t=this.rules.inline.code.exec(e);if(t){let e=t[2].replace(this.rules.other.newLineCharGlobal,` `),n=this.rules.other.nonSpaceChar.test(e),r=this.rules.other.startingSpaceChar.test(e)&&this.rules.other.endingSpaceChar.test(e);return n&&r&&(e=e.substring(1,e.length-1)),{type:`codespan`,raw:t[0],text:e}}}br(e){let t=this.rules.inline.br.exec(e);if(t)return{type:`br`,raw:t[0]}}del(e,t,n=``){let r=this.rules.inline.delLDelim.exec(e);if(r&&(!r[1]||!n||this.rules.inline.punctuation.exec(n))){let n=[...r[0]].length-1,i,a,o=n,s=this.rules.inline.delRDelim,c=at(this,t),l=t.length-e.length+n;if(c<l)return;t=t.slice(-1*e.length+n);let u=c-l;for(s.lastIndex=0;(r=s.exec(t))!==null&&!(r.index>u);){if(i=r[1]||r[2]||r[3]||r[4]||r[5]||r[6],!i||(a=[...i].length,a!==n))continue;if(r[3]||r[4]){o+=a;continue}if(o-=a,o>0)continue;a=Math.min(a,a+o);let t=[...r[0]][0].length,s=e.slice(0,n+r.index+t+a),c=s.slice(n,-n);return{type:`del`,raw:s,text:c,tokens:this.lexer.inlineTokens(c)}}}}autolink(e){let t=this.rules.inline.autolink.exec(e);if(t){let e,n;return t[2]===`@`?(e=t[1],n=`mailto:`+e):(e=t[1],n=e),{type:`link`,raw:t[0],text:e,href:n,autolink:!0,tokens:[{type:`text`,raw:e,text:e}]}}}url(e){let t;if(t=this.rules.inline.url.exec(e)){let e,n;if(t[2]===`@`)e=t[0],n=`mailto:`+e;else{let r;do r=t[0],t[0]=this.rules.inline._backpedal.exec(t[0])?.[0]??``;while(r!==t[0]);e=t[0],n=t[1]===`www.`?`http://`+t[0]:t[0]}return{type:`link`,raw:t[0],text:e,href:n,autolink:!0,tokens:[{type:`text`,raw:e,text:e}]}}}inlineText(e){let t=this.rules.inline.text.exec(e);if(t){let e=this.lexer.state.inRawBlock;return{type:`text`,raw:t[0],text:e?t[0]:Je(t[0]),escaped:e}}}},H=class e{tokens;options;state;inlineQueue;tokenizer;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||l,this.options.tokenizer=this.options.tokenizer||new ut,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,linkEmitted:!1,linkParenPossible:!0,top:!0};let t={other:h,block:We.normal,inline:Ge.normal};this.options.pedantic?(t.block=We.pedantic,t.inline=Ge.pedantic):this.options.gfm&&(t.block=We.gfm,t.inline=this.options.breaks?Ge.breaks:Ge.gfm),this.tokenizer.rules=t}static get rules(){return{block:We,inline:Ge}}static lex(t,n){return new e(n).lex(t)}static lexInline(t,n){return new e(n).inlineTokens(t)}lex(e){e=e.replace(h.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let e=0;e<this.inlineQueue.length;e++){let t=this.inlineQueue[e];this.state.inRawBlock=!1,this.inlineTokens(t.src,t.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,t=[],n=!1){this.tokenizer.lexer=this,this.options.pedantic&&(e=e.replace(h.tabCharGlobal,`    `).replace(h.spaceLine,``));let r=1/0;for(;e;){if(e.length<r)r=e.length;else{this.infiniteLoopError(e.charCodeAt(0));break}let i;if(this.options.extensions?.block?.some(n=>(i=n.call({lexer:this},e,t))?(e=e.substring(i.raw.length),t.push(i),!0):!1))continue;if(i=this.tokenizer.space(e)){e=e.substring(i.raw.length);let n=t.at(-1);i.raw.length===1&&n!==void 0?n.raw+=`
`:t.push(i);continue}if(i=this.tokenizer.code(e)){e=e.substring(i.raw.length);let n=t.at(-1);n?.type===`paragraph`||n?.type===`text`?(n.raw+=(n.raw.endsWith(`
`)?``:`
`)+i.raw,n.text+=`
`+i.text,this.inlineQueue.at(-1).src=n.text):t.push(i);continue}if((i=this.tokenizer.fences(e))||(i=this.tokenizer.heading(e))||(i=this.tokenizer.hr(e))||(i=this.tokenizer.blockquote(e))||(i=this.tokenizer.list(e))||(i=this.tokenizer.html(e))){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.def(e)){e=e.substring(i.raw.length);let n=t.at(-1);n?.type===`paragraph`||n?.type===`text`?(n.raw+=(n.raw.endsWith(`
`)?``:`
`)+i.raw,n.text+=`
`+i.raw,this.inlineQueue.at(-1).src=n.text):(this.tokens.links[i.tag]||(this.tokens.links[i.tag]={href:i.href,title:i.title}),t.push(i));continue}if((i=this.tokenizer.table(e))||(i=this.tokenizer.lheading(e))){e=e.substring(i.raw.length),t.push(i);continue}let a=e;if(this.options.extensions?.startBlock){let t=1/0,n=e.slice(1),r;this.options.extensions.startBlock.forEach(e=>{r=e.call({lexer:this},n),typeof r==`number`&&r>=0&&(t=Math.min(t,r))}),t<1/0&&t>=0&&(a=e.substring(0,t+1))}if(this.state.top&&(i=this.tokenizer.paragraph(a))){let r=t.at(-1);n&&r?.type===`paragraph`?(r.raw+=(r.raw.endsWith(`
`)?``:`
`)+i.raw,r.text+=`
`+i.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=r.text):t.push(i),n=a.length!==e.length,e=e.substring(i.raw.length)}else if(i=this.tokenizer.text(e)){e=e.substring(i.raw.length);let n=t.at(-1);n?.type===`text`?(n.raw+=(n.raw.endsWith(`
`)?``:`
`)+i.raw,n.text+=`
`+i.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=n.text):t.push(i)}else if(e){this.infiniteLoopError(e.charCodeAt(0));break}}return this.state.top=!0,t}inline(e,t=[]){return this.inlineQueue.push({src:e,tokens:t}),t}linkInText(e){if(!e.includes(`[`))return!1;let t=this.tokenizer.rules.inline.link;for(let n of e.matchAll(this.tokenizer.rules.inline.blockSkip))if(t.test(n[0])&&e.charAt(n.index-1)!==`!`)return!0;for(let t of e.matchAll(this.tokenizer.rules.inline.reflinkSearch)){let e=t[0],n=e.lastIndexOf(`[`);if(e.charAt(0)!==`!`&&Object.hasOwn(this.tokens.links,Qe(e.slice(n+1,-1)))&&!(n>1&&this.linkInText(e.slice(1,n-1))))return!0}return!1}inlineTokens(e,t=[]){this.tokenizer.lexer=this;let n=this.state.linkParenPossible;this.state.linkParenPossible=n&&e.includes(`)`);try{return this.#e(e,t)}finally{this.state.linkParenPossible=n}}#e(e,t){let n=e.includes(`*`)||e.includes(`_`)||e.includes(`~`)||this.options.hooks?.emStrongMask||this.tokenizer.emStrong!==ut.prototype.emStrong||this.tokenizer.del!==ut.prototype.del?this.#n(e):e;nt(this.tokenizer,n);try{return this.#t(e,n,t)}finally{rt(this.tokenizer)}}#t(e,t,n){let r=!1,i=``,a=1/0;for(;e;){if(e.length<a)a=e.length;else{this.infiniteLoopError(e.charCodeAt(0));break}r||(i=``),r=!1;let o;if(this.options.extensions?.inline?.some(t=>(o=t.call({lexer:this},e,n))?(e=e.substring(o.raw.length),n.push(o),!0):!1))continue;if((o=this.tokenizer.escape(e))||(o=this.tokenizer.tag(e))||(o=this.tokenizer.link(e))){e=e.substring(o.raw.length),n.push(o);continue}if(o=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(o.raw.length);let t=n.at(-1);o.type===`text`&&t?.type===`text`?(t.raw+=o.raw,t.text+=o.text):n.push(o);continue}if((o=this.tokenizer.emStrong(e,t,i))||(o=this.tokenizer.codespan(e))||(o=this.tokenizer.br(e))||(o=this.tokenizer.del(e,t,i))||(o=this.tokenizer.autolink(e))||!this.state.inLink&&(o=this.tokenizer.url(e))){e=e.substring(o.raw.length),n.push(o);continue}let s=e;if(this.options.extensions?.startInline){let t=1/0,n=e.slice(1),r;this.options.extensions.startInline.forEach(e=>{r=e.call({lexer:this},n),typeof r==`number`&&r>=0&&(t=Math.min(t,r))}),t<1/0&&t>=0&&(s=e.substring(0,t+1))}if(o=this.tokenizer.inlineText(s)){e=e.substring(o.raw.length),o.raw.slice(-1)!==`_`&&(i=o.raw.slice(-1)),r=!0;let t=n.at(-1);t?.type===`text`?(t.raw+=o.raw,t.text+=o.text):n.push(o)}else if(e){this.infiniteLoopError(e.charCodeAt(0));break}}return n}#n(e){let t=e;if(this.tokens.links&&e.includes(`[`)){let e=this.tokenizer.rules.inline.reflinkSearch,n=t=>{let r=t.lastIndexOf(`[`);if(!Object.hasOwn(this.tokens.links,Qe(t.slice(r+1,-1))))return t;if(r>1&&t.charAt(0)!==`!`){let i=t.slice(1,r-1);if(this.linkInText(i))return`[`+i.replace(e,n)+`][`+`a`.repeat(t.length-r-2)+`]`}return`[`+`a`.repeat(t.length-2)+`]`};t=t.replace(e,n)}return t=t.replace(this.tokenizer.rules.inline.anyPunctuationOutsideCode,(e,t,n)=>n?`+`.repeat(e.length):t?t+e.slice(t.length,-t.length).replace(/`/g,`+`)+t:e),t=t.replace(this.tokenizer.rules.inline.blockSkip,(e,t,n)=>{let r=n?n.length:0;return e.slice(0,r)+`[`+`a`.repeat(e.length-r-2)+`]`}),t=this.options.hooks?.emStrongMask?.call({lexer:this},t)??t,t}infiniteLoopError(e){let t=`Infinite loop on byte: `+e;if(this.options.silent)console.error(t);else throw Error(t)}},dt=class{options;parser;constructor(e){this.options=e||l}space(e){return``}code({text:e,lang:t,escaped:n}){let r=(t||``).match(h.notSpaceStart)?.[0],i=e?e.replace(h.endingNewline,``)+`
`:``;return r?`<pre><code class="language-`+B(r)+`">`+(n?i:B(i,!0))+`</code></pre>
`:`<pre><code>`+(n?i:B(i,!0))+`</code></pre>
`}blockquote({tokens:e}){return`<blockquote>
${this.parser.parse(e)}</blockquote>
`}html({text:e}){return e}def(e){return``}heading({tokens:e,depth:t}){return`<h${t}>${this.parser.parseInline(e)}</h${t}>
`}hr(e){return`<hr>
`}list(e){let t=e.ordered,n=e.start,r=``;for(let t=0;t<e.items.length;t++){let n=e.items[t];r+=this.listitem(n)}let i=t?`ol`:`ul`,a=t&&n!==1?` start="`+n+`"`:``;return`<`+i+a+`>
`+r+`</`+i+`>
`}listitem(e){return`<li>${this.parser.parse(e.tokens)}</li>
`}checkbox({checked:e}){return`<input `+(e?`checked="" `:``)+`disabled="" type="checkbox"> `}paragraph({tokens:e}){return`<p>${this.parser.parseInline(e)}</p>
`}table(e){let t=``,n=``;for(let t=0;t<e.header.length;t++)n+=this.tablecell(e.header[t]);t+=this.tablerow({text:n});let r=``;for(let t=0;t<e.rows.length;t++){let i=e.rows[t];n=``;for(let e=0;e<i.length;e++)n+=this.tablecell(i[e]);r+=this.tablerow({text:n})}return r&&=`<tbody>${r}</tbody>`,`<table>
<thead>
`+t+`</thead>
`+r+`</table>
`}tablerow({text:e}){return`<tr>
${e}</tr>
`}tablecell(e){let t=this.parser.parseInline(e.tokens),n=e.header?`th`:`td`;return(e.align?`<${n} align="${e.align}">`:`<${n}>`)+t+`</${n}>
`}strong({tokens:e}){return`<strong>${this.parser.parseInline(e)}</strong>`}em({tokens:e}){return`<em>${this.parser.parseInline(e)}</em>`}codespan({text:e}){return`<code>${B(e,!0)}</code>`}br(e){return`<br>`}del({tokens:e}){return`<del>${this.parser.parseInline(e)}</del>`}link({href:e,title:t,text:n,tokens:r,autolink:i}){let a=i?B(n,!0):this.parser.parseInline(r),o=Ye(e);if(o===null)return a;e=B(o,i);let s=`<a href="`+e+`"`;return t&&(s+=` title="`+B(t)+`"`),s+=`>`+a+`</a>`,s}image({href:e,title:t,text:n,tokens:r}){r&&(n=this.parser.parseInline(r,this.parser.textRenderer));let i=Ye(e);if(i===null)return B(n);e=i;let a=`<img src="${B(e)}" alt="${B(n)}"`;return t&&(a+=` title="${B(t)}"`),a+=`>`,a}text(e){return`tokens`in e&&e.tokens?this.parser.parseInline(e.tokens):`escaped`in e&&e.escaped?e.text:B(e.text)}},ft=class{parser;strong({text:e,tokens:t}){return t?this.parser.parseInline(t,this):e}em({text:e,tokens:t}){return t?this.parser.parseInline(t,this):e}codespan({text:e}){return e}del({text:e,tokens:t}){return t?this.parser.parseInline(t,this):e}html({text:e}){return e}text({text:e}){return e}link({text:e,tokens:t}){return t?this.parser.parseInline(t,this):e}image({text:e,tokens:t}){return t?this.parser.parseInline(t,this):e}br(){return``}checkbox({raw:e}){return e}},U=class e{options;renderer;textRenderer;constructor(e){this.options=e||l,this.options.renderer=this.options.renderer||new dt,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new ft,this.textRenderer.parser=this}static parse(t,n){return new e(n).parse(t)}static parseInline(t,n){return new e(n).parseInline(t)}parse(e){this.renderer.parser=this;let t=``;for(let n=0;n<e.length;n++){let r=e[n];if(this.options.extensions?.renderers?.[r.type]){let e=r,n=this.options.extensions.renderers[e.type].call({parser:this},e);if(n!==!1||![`space`,`hr`,`heading`,`code`,`table`,`blockquote`,`list`,`checkbox`,`html`,`def`,`paragraph`,`text`].includes(e.type)){t+=n||``;continue}}let i=r;switch(i.type){case`space`:t+=this.renderer.space(i);break;case`hr`:t+=this.renderer.hr(i);break;case`heading`:t+=this.renderer.heading(i);break;case`code`:t+=this.renderer.code(i);break;case`table`:t+=this.renderer.table(i);break;case`blockquote`:t+=this.renderer.blockquote(i);break;case`list`:t+=this.renderer.list(i);break;case`checkbox`:t+=this.renderer.checkbox(i);break;case`html`:t+=this.renderer.html(i);break;case`def`:t+=this.renderer.def(i);break;case`paragraph`:t+=this.renderer.paragraph(i);break;case`text`:t+=this.renderer.text(i);break;default:{let e=`Token with "`+i.type+`" type was not found.`;if(this.options.silent)return console.error(e),``;throw Error(e)}}}return t}parseInline(e,t=this.renderer){this.renderer.parser=this;let n=``;for(let r=0;r<e.length;r++){let i=e[r];if(this.options.extensions?.renderers?.[i.type]){let e=this.options.extensions.renderers[i.type].call({parser:this},i);if(e!==!1||![`escape`,`html`,`link`,`image`,`checkbox`,`strong`,`em`,`codespan`,`br`,`del`,`text`].includes(i.type)){n+=e||``;continue}}let a=i;switch(a.type){case`escape`:n+=t.text(a);break;case`html`:n+=t.html(a);break;case`link`:n+=t.link(a);break;case`image`:n+=t.image(a);break;case`checkbox`:n+=t.checkbox(a);break;case`strong`:n+=t.strong(a);break;case`em`:n+=t.em(a);break;case`codespan`:n+=t.codespan(a);break;case`br`:n+=t.br(a);break;case`del`:n+=t.del(a);break;case`text`:n+=t.text(a);break;default:{let e=`Token with "`+a.type+`" type was not found.`;if(this.options.silent)return console.error(e),``;throw Error(e)}}}return n}},pt=class{options;block;constructor(e){this.options=e||l}static passThroughHooks=new Set([`preprocess`,`postprocess`,`processAllTokens`,`emStrongMask`]);static passThroughHooksRespectAsync=new Set([`preprocess`,`postprocess`,`processAllTokens`]);preprocess(e){return e}postprocess(e){return e}processAllTokens(e){return e}emStrongMask(e){return e}provideLexer(e=this.block){return e?H.lex:H.lexInline}provideParser(e=this.block){return e?U.parse:U.parseInline}};function W(e,t){if(Array.isArray(t))for(let n=0;n<t.length;n++)e.push(t[n]);else e.push(t)}var mt=class{defaults=c();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=U;Renderer=dt;TextRenderer=ft;Lexer=H;Tokenizer=ut;Hooks=pt;constructor(...e){this.use(...e)}walkTokens(e,t){let n=[];for(let r of e)switch(W(n,t.call(this,r)),r.type){case`table`:{let e=r;for(let r of e.header)W(n,this.walkTokens(r.tokens,t));for(let r of e.rows)for(let e of r)W(n,this.walkTokens(e.tokens,t));break}case`list`:{let e=r;W(n,this.walkTokens(e.items,t));break}default:{let e=r;this.defaults.extensions?.childTokens?.[e.type]?this.defaults.extensions.childTokens[e.type].forEach(r=>{let i=e[r].flat(1/0);W(n,this.walkTokens(i,t))}):e.tokens&&W(n,this.walkTokens(e.tokens,t))}}return n}use(...e){let t=this.defaults.extensions||{renderers:Object.create(null),childTokens:Object.create(null)};return e.forEach(e=>{let n={...e};if(n.async=this.defaults.async||n.async||!1,e.extensions&&(e.extensions.forEach(e=>{if(!e.name)throw Error(`extension name required`);if(`renderer`in e){let n=t.renderers[e.name];n?t.renderers[e.name]=function(...t){let r=e.renderer.apply(this,t);return r===!1&&(r=n.apply(this,t)),r}:t.renderers[e.name]=e.renderer}if(`tokenizer`in e){if(!e.level||e.level!==`block`&&e.level!==`inline`)throw Error(`extension level must be 'block' or 'inline'`);let n=t[e.level];n?n.unshift(e.tokenizer):t[e.level]=[e.tokenizer],e.start&&(e.level===`block`?t.startBlock?t.startBlock.push(e.start):t.startBlock=[e.start]:e.level===`inline`&&(t.startInline?t.startInline.push(e.start):t.startInline=[e.start]))}`childTokens`in e&&e.childTokens&&(t.childTokens[e.name]=e.childTokens)}),n.extensions=t),e.renderer){let t=this.defaults.renderer||new dt(this.defaults);for(let n in e.renderer){if(!(n in t))throw Error(`renderer '${n}' does not exist`);if([`options`,`parser`].includes(n))continue;let r=n,i=e.renderer[r],a=t[r];t[r]=(...e)=>{let n=i.apply(t,e);return n===!1&&(n=a.apply(t,e)),n===!1?``:n??``}}n.renderer=t}if(e.tokenizer){let t=this.defaults.tokenizer||new ut(this.defaults);for(let n in e.tokenizer){if(!(n in t))throw Error(`tokenizer '${n}' does not exist`);if([`options`,`rules`,`lexer`].includes(n))continue;let r=n,i=e.tokenizer[r],a=t[r];t[r]=(...e)=>{let n=i.apply(t,e);return n===!1&&(n=a.apply(t,e)),n}}n.tokenizer=t}if(e.hooks){let t=this.defaults.hooks||new pt;for(let n in e.hooks){if(!(n in t))throw Error(`hook '${n}' does not exist`);if([`options`,`block`].includes(n))continue;let r=n,i=e.hooks[r],a=t[r];t[r]=pt.passThroughHooks.has(n)?e=>{if(t.options.async&&pt.passThroughHooksRespectAsync.has(n))return(async()=>{let n=await i.call(t,e);return a.call(t,n)})();let r=i.call(t,e);return a.call(t,r)}:(...e)=>{if(t.options.async)return(async()=>{let n=await i.apply(t,e);return n===!1&&(n=await a.apply(t,e)),n})();let n=i.apply(t,e);return n===!1&&(n=a.apply(t,e)),n}}n.hooks=t}if(e.walkTokens){let t=this.defaults.walkTokens,r=e.walkTokens;n.walkTokens=function(e){let n=[];return W(n,r.call(this,e)),t&&W(n,t.call(this,e)),n}}this.defaults={...this.defaults,...n}}),this}setOptions(e){return this.defaults={...this.defaults,...e},this}lexer(e,t){return H.lex(e,t??this.defaults)}parser(e,t){return U.parse(e,t??this.defaults)}parseMarkdown(e){return(t,n)=>{let r={...n},i={...this.defaults,...r},a=this.onError(!!i.silent,!!i.async);if(this.defaults.async===!0&&r.async===!1)return a(Error(`marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise.`));if(typeof t>`u`||t===null)return a(Error(`marked(): input parameter is undefined or null`));if(typeof t!=`string`)return a(Error(`marked(): input parameter is of type `+Object.prototype.toString.call(t)+`, string expected`));if(i.hooks&&(i.hooks.options=i,i.hooks.block=e),i.async)return(async()=>{let n=i.hooks?await i.hooks.preprocess(t):t,r=await(i.hooks?await i.hooks.provideLexer(e):e?H.lex:H.lexInline)(n,i),a=i.hooks?await i.hooks.processAllTokens(r):r;i.walkTokens&&await Promise.all(this.walkTokens(a,i.walkTokens));let o=await(i.hooks?await i.hooks.provideParser(e):e?U.parse:U.parseInline)(a,i);return i.hooks?await i.hooks.postprocess(o):o})().catch(a);try{i.hooks&&(t=i.hooks.preprocess(t));let n=(i.hooks?i.hooks.provideLexer(e):e?H.lex:H.lexInline)(t,i);i.hooks&&(n=i.hooks.processAllTokens(n)),i.walkTokens&&this.walkTokens(n,i.walkTokens);let r=(i.hooks?i.hooks.provideParser(e):e?U.parse:U.parseInline)(n,i);return i.hooks&&(r=i.hooks.postprocess(r)),r}catch(e){return a(e)}}}onError(e,t){return n=>{if(n.message+=`
Please report this to https://github.com/markedjs/marked.`,e){let e=`<p>An error occurred:</p><pre>`+B(n.message+``,!0)+`</pre>`;return t?Promise.resolve(e):e}if(t)return Promise.reject(n);throw n}}},ht=new mt;function G(e,t){return ht.parse(e,t)}G.options=G.setOptions=function(e){return ht.setOptions(e),G.defaults=ht.defaults,u(G.defaults),G},G.getDefaults=c,G.defaults=l;function gt(...e){return ht.use(...e),G.defaults=ht.defaults,u(G.defaults),G}G.use=gt,G.walkTokens=function(e,t){return ht.walkTokens(e,t)},G.parseInline=ht.parseInline,G.Parser=U,G.parser=U.parse,G.Renderer=dt,G.TextRenderer=ft,G.Lexer=H,G.lexer=H.lex,G.Tokenizer=ut,G.Hooks=pt,G.parse=G,G.options,G.setOptions,G.walkTokens,G.parseInline,U.parse,H.lex;function _t(e){let t=(e,t)=>`<code class="math-error" title="${String(t).replace(/"/g,`&quot;`)}">${e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`)}</code>`,n=(n,r)=>{try{return e.render(n,r)}catch(e){return t(n,e)}};return{extensions:[{name:`math`,level:`block`,start:e=>/(^|\n)\$\$/.exec(e)?.index,tokenizer(e){let t=/^\$\$[ \t]*\n([\s\S]+?)\n[ \t]*\$\$[ \t]*(?:\n|$)/.exec(e)??/^\$\$([^\n]+?)\$\$[ \t]*(?:\n|$)/.exec(e);if(t)return{type:`math`,raw:t[0],text:t[1].trim(),display:!0}},renderer(e){return`<div class="math-display">${n(e.text,!0)}</div>\n`}},{name:`math-inline`,level:`inline`,start:e=>{let t=e.search(/(^|[^\\])\$/);return t<0?void 0:e[t]===`$`?t:t+1},tokenizer(e){let t=/^\$\$([^\n$]+?)\$\$/.exec(e);if(t)return{type:`math-inline`,raw:t[0],text:t[1].trim(),display:!0};let n=/^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(e);if(n)return{type:`math-inline`,raw:n[0],text:n[1],display:!1}},renderer(e){let t=e;return n(t.text,t.display)}}]}}var vt={font:`sans-serif`,mono:`monospace`,size:16,lineHeight:1.5,justify:!1,h1Rule:!0,h2Rule:!0,headingWeight:600,accentHeadings:!1,chapterBreak:!1,radius:6,wideTables:!1},yt={size:`A4`,margin:`32px`},bt=new Set(`title.subtitle.author.date.template.toc.cover.logo.accent.font.page_size.stamp.lang.dir.header.footer.margin.orientation.toc_depth.toc_title.cover_style.numbering.footnotes.mermaid_theme.mermaid_mode.mermaid_directives`.split(`.`)),xt=new Set([`toc`,`cover`,`numbering`,`mermaid_directives`]),St=new Set([`toc_depth`]);function Ct(e){let t={};for(let n of e.split(/\r?\n/)){let e=/^([A-Za-z_][\w-]*):[ \t]*(.*?)[ \t]*$/.exec(n);if(!e)continue;let r=e[1].replace(/-/g,`_`);if(!bt.has(r))continue;let i=e[2],a=/^(["'])(.*)\1$/.exec(i);if(i=a?a[2]:i.replace(/[ \t]+#.*$/,``),i!==``){if(xt.has(r))a||i!==`true`&&i!==`false`||(t[r]=i===`true`);else if(St.has(r)){let e=Number(i);Number.isInteger(e)&&e>=1&&e<=6&&(t[r]=e)}else t[r]=i}}return t}function wt(e){return e.split(/<br\s*\/?>/i).map(Tt).join(`<br>`)}var Tt=e=>e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`);function Et(e,t){let n={title:t.title&&wt(t.title).replace(/<br>/g,` `),author:t.author&&Tt(t.author),date:t.date&&Tt(t.date),stamp:t.stamp&&Tt(t.stamp)};return e.replace(/\{\{(title|author|date|stamp)\}\}/g,(e,t)=>n[t]??``)}var K=`font-size:11px;color:#6b7280;font-family:sans-serif;line-height:1.2;`,Dt={default:{description:`GitHub-like page, good for images and quick PDFs`},report:{description:`Business document: cover, contents, the title in the header and the page number in the footer`,type:{size:15,lineHeight:1.65,h1Rule:!1,h2Rule:!1,accentHeadings:!0,headingWeight:700,radius:4,wideTables:!0},page:{margin:`26mm 22mm 24mm`,header:`<div style="${K}display:flex;justify-content:space-between;padding-top:8mm"><span>{{title}}</span><span>{{stamp}}</span></div>`,footer:`<div style="${K}display:flex;justify-content:space-between;padding-bottom:8mm"><span>{{author}}</span><span>{{pageNumber}} / {{totalPages}}</span></div>`},defaults:{cover:!0,toc:!0,accent:`#1d4ed8`},css:`.markdown-body h2 { margin-top: 32px; padding-bottom: 6px; border-bottom: 2px solid var(--accent, #1d4ed8); }
.markdown-body h1 { margin-top: 40px; }
.cover { margin: 60mm 0 0; padding-left: 14px; border-left: 6px solid var(--accent, #1d4ed8); }`},proposal:{description:`Proposal / quotation: cover, accent bars on sections, tinted table headers and call-out quotes`,type:{size:14,lineHeight:1.7,h1Rule:!1,h2Rule:!1,accentHeadings:!0,headingWeight:700,radius:4,wideTables:!0},page:{margin:`24mm 20mm 22mm`,header:`<div style="${K}text-align:right;padding-top:8mm">{{stamp}}</div>`,footer:`<div style="${K}display:flex;justify-content:space-between;padding-bottom:8mm"><span>{{title}}</span><span>{{pageNumber}} / {{totalPages}}</span></div>`},defaults:{cover:!0,toc:!1,accent:`#0f766e`},css:`.markdown-body h1 { margin-top: 36px; padding: 2px 0 2px 12px; border-left: 6px solid var(--accent, #0f766e); font-size: 1.7em; }
.markdown-body h2 { margin-top: 28px; font-size: 1.25em; }
.markdown-body th { color: #ffffff; background: var(--accent, #0f766e); }
.markdown-body tr:nth-child(2n) { background: var(--surface, #f1f5f9); }
.markdown-body blockquote { padding: 10px 16px; border-left: 4px solid var(--accent, #0f766e); background: var(--surface, #f1f5f9); }
.cover { margin: 70mm 0 0; padding: 0 0 0 14px; border-left: 8px solid var(--accent, #0f766e); }`},book:{description:`Book: serif text, justified, every chapter (h1) on a new page, inner-margin friendly page`,type:{font:`serif`,size:15,lineHeight:1.8,justify:!0,h1Rule:!1,h2Rule:!1,headingWeight:700,chapterBreak:!0,radius:3,wideTables:!0},page:{size:`A5`,margin:`20mm 17mm 22mm`,header:`<div style="${K}display:flex;justify-content:space-between;padding-top:9mm"><span>{{title}}</span><span>{{chapter}}</span></div>`,footer:`<div style="${K}text-align:center;padding-bottom:9mm">{{pageNumber}}</div>`},defaults:{cover:!0,toc:!0,accent:`#7c2d12`},css:`.markdown-body h1 { margin: 0 0 1.4em; font-size: 1.9em; text-align: center; }
.markdown-body h2 { margin-top: 1.8em; font-size: 1.3em; }
.markdown-body p { margin-bottom: 0; text-indent: 1em; }
.markdown-body p:first-child, .markdown-body h1 + p, .markdown-body h2 + p, .markdown-body h3 + p { text-indent: 0; }
.markdown-body p + p { margin-top: 0; }
.cover { margin: 45mm 0 0; text-align: center; }`},paper:{description:`Paper / technical note: serif, justified, tight leading, numbers in the footer`,type:{font:`serif`,size:13,lineHeight:1.55,justify:!0,h1Rule:!1,h2Rule:!1,headingWeight:700,radius:2,wideTables:!0},page:{margin:`22mm 20mm`,footer:`<div style="${K}text-align:center;padding-bottom:8mm">{{pageNumber}}</div>`},defaults:{cover:!1,toc:!1},css:`.markdown-body h1 { margin: 0 0 0.6em; font-size: 1.8em; text-align: center; }
.markdown-body h2 { margin-top: 1.4em; margin-bottom: 0.5em; font-size: 1.2em; }
.markdown-body h3 { margin-top: 1.1em; margin-bottom: 0.4em; font-size: 1.05em; font-style: italic; }
.markdown-body p { margin-bottom: 0.7em; }
.markdown-body table { font-size: 0.92em; }`},compact:{description:`Notes and cheat sheets: small text, narrow margins, no cover or contents`,type:{size:12,lineHeight:1.4,h1Rule:!1,h2Rule:!1,headingWeight:600,radius:3},page:{margin:`12mm 12mm`},defaults:{cover:!1,toc:!1},css:`.markdown-body h1 { margin: 0.8em 0 0.4em; font-size: 1.5em; }
.markdown-body h2 { margin: 0.9em 0 0.35em; font-size: 1.25em; }
.markdown-body h3 { margin: 0.8em 0 0.3em; font-size: 1.1em; }
.markdown-body p, .markdown-body ul, .markdown-body ol, .markdown-body blockquote, .markdown-body pre, .markdown-body table { margin-bottom: 8px; }
.markdown-body th, .markdown-body td { padding: 3px 8px; }
.markdown-body pre { padding: 8px 10px; }`},manual:{description:`Manual / specification: chapters on new pages, numbered headings, cover, contents, call-outs`,type:{size:14,lineHeight:1.7,h1Rule:!1,h2Rule:!1,accentHeadings:!0,headingWeight:700,chapterBreak:!0,radius:4,wideTables:!0},page:{margin:`24mm 20mm 22mm`,header:`<div style="${K}display:flex;justify-content:space-between;padding-top:8mm"><span>{{title}}</span><span>{{stamp}}</span></div>`,footer:`<div style="${K}display:flex;justify-content:space-between;padding-bottom:8mm"><span>{{author}}</span><span>{{pageNumber}} / {{totalPages}}</span></div>`},defaults:{cover:!0,toc:!0,numbering:!0,accent:`#0369a1`},css:`.markdown-body h1 { margin: 0 0 20px; padding-bottom: 8px; font-size: 1.8em; border-bottom: 3px solid var(--accent, #0369a1); }
.markdown-body h2 { margin-top: 28px; padding-bottom: 4px; font-size: 1.3em; border-bottom: 1px solid var(--border); }
.markdown-body h3 { margin-top: 22px; font-size: 1.1em; }
.markdown-body th { background: var(--surface); }
.markdown-body pre { border-left: 3px solid var(--accent, #0369a1); }
.cover { margin: 55mm 0 0; padding-left: 14px; border-left: 8px solid var(--accent, #0369a1); }`},minutes:{description:`Meeting minutes: no cover, a ruled title, tinted table headers, check lists for the to-dos`,type:{size:13,lineHeight:1.65,h1Rule:!1,h2Rule:!1,accentHeadings:!1,headingWeight:700,radius:4,wideTables:!0},page:{margin:`22mm 20mm 20mm`,header:`<div style="${K}display:flex;justify-content:space-between;padding-top:8mm"><span>{{title}}</span><span>{{date}}</span></div>`,footer:`<div style="${K}text-align:right;padding-bottom:8mm">{{pageNumber}} / {{totalPages}}</div>`},defaults:{cover:!1,toc:!1,accent:`#475569`},css:`.markdown-body h1 { margin: 0 0 16px; padding-bottom: 8px; font-size: 1.6em; border-bottom: 2px solid var(--accent, #475569); }
.markdown-body h2 { margin-top: 22px; margin-bottom: 8px; padding-left: 10px; font-size: 1.1em; border-left: 4px solid var(--accent, #475569); }
.markdown-body th { background: var(--surface); }
.markdown-body ul { margin-bottom: 10px; }`},letter:{description:`Business letter: serif, wide margins, no cover or contents; .right and .center classes for the address block`,type:{font:`serif`,size:14,lineHeight:1.9,h1Rule:!1,h2Rule:!1,headingWeight:700,radius:2},page:{margin:`28mm 25mm 25mm`},defaults:{cover:!1,toc:!1},css:`.markdown-body h1 { margin: 1.4em 0 1.2em; font-size: 1.4em; text-align: center; letter-spacing: 0.2em; }
.markdown-body h2 { margin: 1.4em 0 0.4em; font-size: 1.1em; }
.markdown-body p { margin-bottom: 1em; }
.markdown-body .right { text-align: right; }
.markdown-body .center { text-align: center; }
.markdown-body hr { margin: 1.6em 0; border-top: 1px solid var(--border); }`},slides:{description:`Slide-like pages: A4 landscape, large text, each h2 on its own page (a --- rule is ignored)`,type:{size:28,lineHeight:1.5,h1Rule:!1,h2Rule:!1,accentHeadings:!0,headingWeight:700,radius:6,wideTables:!0},page:{size:`A4 landscape`,margin:`16mm 20mm 18mm`,footer:`<div style="${K}display:flex;justify-content:space-between;padding-bottom:7mm"><span>{{title}}</span><span>{{pageNumber}}</span></div>`},defaults:{cover:!0,toc:!1,accent:`#1d4ed8`},css:`.markdown-body h1 { margin: 0 0 0.6em; font-size: 2.2em; break-before: page; }
.markdown-body h2 { margin: 0 0 0.6em; padding-bottom: 6px; font-size: 1.6em; border-bottom: 3px solid var(--accent, #1d4ed8); break-before: page; }
.markdown-body h1 + h2 { break-before: auto; }
.markdown-body h3 { font-size: 1.2em; }
.markdown-body hr { display: none; }
.markdown-body li + li { margin-top: 0.4em; }
.cover { margin: 40mm 0 0; padding-left: 18px; border-left: 10px solid var(--accent, #1d4ed8); }
.cover-title { font-size: 2.4em; }`},invoice:{description:`Invoice / quotation: a title at the right, a ruled items table with the total emphasised, notes in a box`,type:{size:13,lineHeight:1.6,h1Rule:!1,h2Rule:!1,accentHeadings:!1,headingWeight:700,radius:4,wideTables:!0},page:{margin:`22mm 20mm 20mm`,header:`<div style="${K}text-align:right;padding-top:8mm">{{stamp}}</div>`,footer:`<div style="${K}display:flex;justify-content:space-between;padding-bottom:8mm"><span>{{author}}</span><span>{{pageNumber}} / {{totalPages}}</span></div>`},defaults:{cover:!1,toc:!1,accent:`#0f172a`},css:`.markdown-body h1 { margin: 0 0 24px; font-size: 2em; text-align: right; letter-spacing: 0.3em; }
.markdown-body h2 { margin-top: 24px; margin-bottom: 8px; padding-bottom: 4px; font-size: 1.05em; border-bottom: 2px solid var(--accent, #0f172a); }
.markdown-body th { color: #ffffff; background: var(--accent, #0f172a); }
.markdown-body tr:nth-child(2n) { background: transparent; }
.markdown-body tr:last-child td { font-weight: 700; background: var(--surface); }
.markdown-body .right { text-align: right; }`}};function Ot(){return Object.entries(Dt).map(([e,t])=>({name:e,description:t.description??``}))}function kt(e){let t=At(e.extends);return{description:e.description??t.description,type:{...t.type,...e.type},page:{...t.page,...e.page},defaults:{...t.defaults,...e.defaults},css:[t.css,e.css].filter(Boolean).join(`
`)}}function At(e){if(e===void 0)return Dt.default;if(typeof e!=`string`)return e.extends===void 0?e:kt(e);let t=Dt[e];if(!t)throw Error(`unknown template "${e}". Choose from: ${Object.keys(Dt).join(`, `)}`);return t}var jt={en:{note:`Note`,tip:`Tip`,important:`Important`,warning:`Warning`,caution:`Caution`},ja:{note:`補足`,tip:`ヒント`,important:`重要`,warning:`注意`,caution:`警告`}},Mt=/^<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:<br\s*\/?>|\n)?\s*/i;function Nt(e,t){let n=Mt.exec(e);if(!n)return;let r=n[1].toLowerCase(),i=e.slice(n[0].length),a=i.startsWith(`</p>`)?i.slice(4):`<p>${i}`;return`<div class="callout callout-${r}"><p class="callout-title">${jt[t?.toLowerCase().startsWith(`ja`)?`ja`:`en`][r]}</p>${a}</div>\n`}function Pt(e,t){return t?.toLowerCase().startsWith(`ja`)?`図 ${e}`:`Figure ${e}`}function Ft(e){return/^\s*<!--\s*(?:page-?break|new-?page)\s*-->\s*$/i.test(e)?`<div class="pagebreak"></div>
`:void 0}function It(){let e=new Map,t=new Map,n=[],r=new Map;return{extract(t){let n=[],r=``,i;for(let a of t.split(`
`)){let t=/^\s{0,3}(```+|~~~+)/.exec(a);t&&(r?t[1][0]===r&&(r=``):r=t[1][0]);let o=r?null:/^\[\^([^\]\s]+)\]:[ \t]*(.*)$/.exec(a);o?(i=o[1],e.set(i,o[2].trim())):i!==void 0&&/^(?: {2,}|\t)\S/.test(a)?e.set(i,`${e.get(i)} ${a.trim()}`):(i=void 0,n.push(a))}return n.join(`
`)},extension:{extensions:[{name:`footnoteRef`,level:`inline`,start:e=>e.indexOf(`[^`),tokenizer(t){let n=/^\[\^([^\]\s]+)\]/.exec(t);if(n&&e.has(n[1]))return{type:`footnoteRef`,raw:n[0],id:n[1]}},renderer(e){let i=String(e.id);t.has(i)||(t.set(i,t.size+1),n.push(i));let a=t.get(i),o=(r.get(i)??0)+1;return r.set(i,o),`<sup class="fnref"><a id="fnref-${a}-${o}" href="#fn-${a}">${a}</a></sup>`}}]},list(r,i,a){if(!n.length)return``;let o=n.map(n=>`<li id="fn-${t.get(n)}">${r(e.get(n)??``)}</li>`).join(``);return a?`<section class="footnotes" data-pdf-footnotes><ol>${o}</ol></section>\n`:`<section class="footnotes">${i?`<p class="footnotes-title">${Tt(i)}</p>`:``}<ol>${o}</ol></section>\n`}}}var Lt=e(t(((e,t)=>{function n(e){return e instanceof Map?e.clear=e.delete=e.set=function(){throw Error(`map is read-only`)}:e instanceof Set&&(e.add=e.clear=e.delete=function(){throw Error(`set is read-only`)}),Object.freeze(e),Object.getOwnPropertyNames(e).forEach(t=>{let r=e[t],i=typeof r;i!==`object`&&i!==`function`||Object.isFrozen(r)||n(r)}),e}var r=class{constructor(e){e.data===void 0&&(e.data={}),this.data=e.data,this.isMatchIgnored=!1}ignoreMatch(){this.isMatchIgnored=!0}};function i(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#x27;`)}function a(e,...t){let n=Object.create(null);for(let t in e)n[t]=e[t];return t.forEach(function(e){for(let t in e)n[t]=e[t]}),n}var o=`</span>`,s=e=>!!e.scope,c=(e,{prefix:t})=>{if(e.startsWith(`language:`))return e.replace(`language:`,`language-`);if(e.includes(`.`)){let n=e.split(`.`);return[`${t}${n.shift()}`,...n.map((e,t)=>`${e}${`_`.repeat(t+1)}`)].join(` `)}return`${t}${e}`},l=class{constructor(e,t){this.buffer=``,this.classPrefix=t.classPrefix,e.walk(this)}addText(e){this.buffer+=i(e)}openNode(e){if(!s(e))return;let t=c(e.scope,{prefix:this.classPrefix});this.span(t)}closeNode(e){s(e)&&(this.buffer+=o)}value(){return this.buffer}span(e){this.buffer+=`<span class="${e}">`}},u=(e={})=>{let t={children:[]};return Object.assign(t,e),t},d=class e{constructor(){this.rootNode=u(),this.stack=[this.rootNode]}get top(){return this.stack[this.stack.length-1]}get root(){return this.rootNode}add(e){this.top.children.push(e)}openNode(e){let t=u({scope:e});this.add(t),this.stack.push(t)}closeNode(){if(this.stack.length>1)return this.stack.pop()}closeAllNodes(){for(;this.closeNode(););}toJSON(){return JSON.stringify(this.rootNode,null,4)}walk(e){return this.constructor._walk(e,this.rootNode)}static _walk(e,t){return typeof t==`string`?e.addText(t):t.children&&(e.openNode(t),t.children.forEach(t=>this._walk(e,t)),e.closeNode(t)),e}static _collapse(t){typeof t!=`string`&&t.children&&(t.children.every(e=>typeof e==`string`)?t.children=[t.children.join(``)]:t.children.forEach(t=>{e._collapse(t)}))}},f=class extends d{constructor(e){super(),this.options=e}addText(e){e!==``&&this.add(e)}startScope(e){this.openNode(e)}endScope(){this.closeNode()}__addSublanguage(e,t){let n=e.root;t&&(n.scope=`language:${t}`),this.add(n)}toHTML(){return new l(this,this.options).value()}finalize(){return this.closeAllNodes(),!0}};function p(e){return e?typeof e==`string`?e:e.source:null}function m(e){return _(`(?=`,e,`)`)}function h(e){return _(`(?:`,e,`)*`)}function g(e){return _(`(?:`,e,`)?`)}function _(...e){return e.map(e=>p(e)).join(``)}function v(e){let t=e[e.length-1];return typeof t==`object`&&t.constructor===Object?(e.splice(e.length-1,1),t):{}}function y(...e){return`(`+(v(e).capture?``:`?:`)+e.map(e=>p(e)).join(`|`)+`)`}function b(e){return RegExp(e.toString()+`|`).exec(``).length-1}function x(e,t){let n=e&&e.exec(t);return n&&n.index===0}var S=new RegExp(y(/\[(?:[^\\\]]|\\.)*\]/,/\(\?<(?![=!])[^>]+>/,/\(\?'[^']+'/,/\(\??/,/\\([1-9][0-9]*)/,/\\./));function C(e,{joinWith:t}){let n=0;return e.map(e=>{n+=1;let t=n,r=p(e),i=``;for(;r.length>0;){let e=S.exec(r);if(!e){i+=r;break}i+=r.substring(0,e.index),r=r.substring(e.index+e[0].length),e[0][0]===`\\`&&e[1]?i+=`\\`+String(Number(e[1])+t):(i+=e[0],(e[0]===`(`||/^\(\?[<']/.test(e[0]))&&n++)}return i}).map(e=>`(${e})`).join(t)}var w=/\b\B/,T=`[a-zA-Z]\\w*`,E=`[a-zA-Z_]\\w*`,D=`\\b\\d+(\\.\\d+)?`,O=`(-?)(\\b0[xX][a-fA-F0-9]+|(\\b\\d+(\\.\\d*)?|\\.\\d+)([eE][-+]?\\d+)?)`,k=`\\b(0b[01]+)`,A=`!|!=|!==|%|%=|&|&&|&=|\\*|\\*=|\\+|\\+=|,|-|-=|/=|/|:|;|<<|<<=|<=|<|===|==|=|>>>=|>>=|>=|>>>|>>|>|\\?|\\[|\\{|\\(|\\^|\\^=|\\||\\|=|\\|\\||~`,j=(e={})=>{let t=/^#![ ]*\//;return e.binary&&(e.begin=_(t,/.*\b/,e.binary,/\b.*/)),a({scope:`meta`,begin:t,end:/$/,relevance:0,"on:begin":(e,t)=>{e.index!==0&&t.ignoreMatch()}},e)},M={begin:`\\\\[\\s\\S]`,relevance:0},N={scope:`string`,begin:`'`,end:`'`,illegal:`\\n`,contains:[M]},P={scope:`string`,begin:`"`,end:`"`,illegal:`\\n`,contains:[M]},F={begin:/\b(a|an|the|are|I'm|isn't|don't|doesn't|won't|but|just|should|pretty|simply|enough|gonna|going|wtf|so|such|will|you|your|they|like|more)\b/},I=function(e,t,n={}){let r=a({scope:`comment`,begin:e,end:t,contains:[]},n);r.contains.push({scope:`doctag`,begin:`[ ]*(?=(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):)`,end:/(TODO|FIXME|NOTE|BUG|OPTIMIZE|HACK|XXX):/,excludeBegin:!0,relevance:0});let i=y(`I`,`a`,`is`,`so`,`us`,`to`,`at`,`if`,`in`,`it`,`on`,/[A-Za-z]+['](d|ve|re|ll|t|s|n)/,/[A-Za-z]+[-][a-z]+/,/[A-Za-z][a-z]{2,}/);return r.contains.push({begin:_(/[ ]+/,`(`,i,/[.]?[:]?([.][ ]|[ ])/,`){3}`)}),r},L=I(`//`,`$`),ee=I(`/\\*`,`\\*/`),te=I(`#`,`$`),ne=Object.freeze({__proto__:null,APOS_STRING_MODE:N,BACKSLASH_ESCAPE:M,BINARY_NUMBER_MODE:{scope:`number`,begin:k,relevance:0},BINARY_NUMBER_RE:k,COMMENT:I,C_BLOCK_COMMENT_MODE:ee,C_LINE_COMMENT_MODE:L,C_NUMBER_MODE:{scope:`number`,begin:O,relevance:0},C_NUMBER_RE:O,END_SAME_AS_BEGIN:function(e){return Object.assign(e,{"on:begin":(e,t)=>{t.data._beginMatch=e[1]},"on:end":(e,t)=>{t.data._beginMatch!==e[1]&&t.ignoreMatch()}})},HASH_COMMENT_MODE:te,IDENT_RE:T,MATCH_NOTHING_RE:w,METHOD_GUARD:{begin:`\\.\\s*[a-zA-Z_]\\w*`,relevance:0},NUMBER_MODE:{scope:`number`,begin:D,relevance:0},NUMBER_RE:D,PHRASAL_WORDS_MODE:F,QUOTE_STRING_MODE:P,REGEXP_MODE:{scope:`regexp`,begin:/\/(?=[^/\n]*\/)/,end:/\/[gimuy]*/,contains:[M,{begin:/\[/,end:/\]/,relevance:0,contains:[M]}]},RE_STARTERS_RE:A,SHEBANG:j,TITLE_MODE:{scope:`title`,begin:T,relevance:0},UNDERSCORE_IDENT_RE:E,UNDERSCORE_TITLE_MODE:{scope:`title`,begin:E,relevance:0}});function re(e,t){e.input[e.index-1]===`.`&&t.ignoreMatch()}function ie(e,t){e.className!==void 0&&(e.scope=e.className,delete e.className)}function ae(e,t){t&&e.beginKeywords&&(e.begin=`\\b(`+e.beginKeywords.split(` `).join(`|`)+`)(?!\\.)(?=\\b|\\s)`,e.__beforeBegin=re,e.keywords=e.keywords||e.beginKeywords,delete e.beginKeywords,e.relevance===void 0&&(e.relevance=0))}function R(e,t){Array.isArray(e.illegal)&&(e.illegal=y(...e.illegal))}function oe(e,t){if(e.match){if(e.begin||e.end)throw Error(`begin & end are not supported with match`);e.begin=e.match,delete e.match}}function se(e,t){e.relevance===void 0&&(e.relevance=1)}var ce=(e,t)=>{if(!e.beforeMatch)return;if(e.starts)throw Error(`beforeMatch cannot be used with starts`);let n=Object.assign({},e);Object.keys(e).forEach(t=>{delete e[t]}),e.keywords=n.keywords,e.begin=_(n.beforeMatch,m(n.begin)),e.starts={relevance:0,contains:[Object.assign(n,{endsParent:!0})]},e.relevance=0,delete n.beforeMatch},le=[`of`,`and`,`for`,`in`,`not`,`or`,`if`,`then`,`parent`,`list`,`value`],ue=`keyword`;function de(e,t,n=ue){let r=Object.create(null);return typeof e==`string`?i(n,e.split(` `)):Array.isArray(e)?i(n,e):Object.keys(e).forEach(function(n){Object.assign(r,de(e[n],t,n))}),r;function i(e,n){t&&(n=n.map(e=>e.toLowerCase())),n.forEach(function(t){let n=t.split(`|`);r[n[0]]=[e,fe(n[0],n[1])]})}}function fe(e,t){return t?Number(t):+!pe(e)}function pe(e){return le.includes(e.toLowerCase())}var me={},z=e=>{console.error(e)},he=(e,...t)=>{console.log(`WARN: ${e}`,...t)},ge=(e,t)=>{me[`${e}/${t}`]||(console.log(`Deprecated as of ${e}. ${t}`),me[`${e}/${t}`]=!0)},_e=Error();function ve(e,t,{key:n}){let r=0,i=e[n],a={},o={};for(let e=1;e<=t.length;e++)o[e+r]=i[e],a[e+r]=!0,r+=b(t[e-1]);e[n]=o,e[n]._emit=a,e[n]._multi=!0}function ye(e){if(Array.isArray(e.begin)){if(e.skip||e.excludeBegin||e.returnBegin)throw z(`skip, excludeBegin, returnBegin not compatible with beginScope: {}`),_e;if(typeof e.beginScope!=`object`||e.beginScope===null)throw z(`beginScope must be object`),_e;ve(e,e.begin,{key:`beginScope`}),e.begin=C(e.begin,{joinWith:``})}}function be(e){if(Array.isArray(e.end)){if(e.skip||e.excludeEnd||e.returnEnd)throw z(`skip, excludeEnd, returnEnd not compatible with endScope: {}`),_e;if(typeof e.endScope!=`object`||e.endScope===null)throw z(`endScope must be object`),_e;ve(e,e.end,{key:`endScope`}),e.end=C(e.end,{joinWith:``})}}function xe(e){e.scope&&typeof e.scope==`object`&&e.scope!==null&&(e.beginScope=e.scope,delete e.scope)}function Se(e){xe(e),typeof e.beginScope==`string`&&(e.beginScope={_wrap:e.beginScope}),typeof e.endScope==`string`&&(e.endScope={_wrap:e.endScope}),ye(e),be(e)}function Ce(e){function t(t,n){return new RegExp(p(t),`m`+(e.case_insensitive?`i`:``)+(e.unicodeRegex?`u`:``)+(n?`g`:``))}class n{constructor(){this.matchIndexes={},this.regexes=[],this.matchAt=1,this.position=0}addRule(e,t){t.position=this.position++,this.matchIndexes[this.matchAt]=t,this.regexes.push([t,e]),this.matchAt+=b(e)+1}compile(){this.regexes.length===0&&(this.exec=()=>null);let e=this.regexes.map(e=>e[1]);this.matcherRe=t(C(e,{joinWith:`|`}),!0),this.lastIndex=0}exec(e){this.matcherRe.lastIndex=this.lastIndex;let t=this.matcherRe.exec(e);if(!t)return null;let n=t.findIndex((e,t)=>t>0&&e!==void 0),r=this.matchIndexes[n];return t.splice(0,n),Object.assign(t,r)}}class r{constructor(){this.rules=[],this.multiRegexes=[],this.count=0,this.lastIndex=0,this.regexIndex=0}getMatcher(e){if(this.multiRegexes[e])return this.multiRegexes[e];let t=new n;return this.rules.slice(e).forEach(([e,n])=>t.addRule(e,n)),t.compile(),this.multiRegexes[e]=t,t}resumingScanAtSamePosition(){return this.regexIndex!==0}considerAll(){this.regexIndex=0}addRule(e,t){this.rules.push([e,t]),t.type===`begin`&&this.count++}exec(e){let t=this.getMatcher(this.regexIndex);t.lastIndex=this.lastIndex;let n=t.exec(e);if(this.resumingScanAtSamePosition()&&!(n&&n.index===this.lastIndex)){let t=this.getMatcher(0);t.lastIndex=this.lastIndex+1,n=t.exec(e)}return n&&(this.regexIndex+=n.position+1,this.regexIndex===this.count&&this.considerAll()),n}}function i(e){let t=new r;return e.contains.forEach(e=>t.addRule(e.begin,{rule:e,type:`begin`})),e.terminatorEnd&&t.addRule(e.terminatorEnd,{type:`end`}),e.illegal&&t.addRule(e.illegal,{type:`illegal`}),t}function o(n,r){let a=n;if(n.isCompiled)return a;[ie,oe,Se,ce].forEach(e=>e(n,r)),e.compilerExtensions.forEach(e=>e(n,r)),n.__beforeBegin=null,[ae,R,se].forEach(e=>e(n,r)),n.isCompiled=!0;let s=null;return typeof n.keywords==`object`&&n.keywords.$pattern&&(n.keywords=Object.assign({},n.keywords),s=n.keywords.$pattern,delete n.keywords.$pattern),s||=/\w+/,n.keywords&&=de(n.keywords,e.case_insensitive),a.keywordPatternRe=t(s,!0),r&&(n.begin||=/\B|\b/,a.beginRe=t(a.begin),!n.end&&!n.endsWithParent&&(n.end=/\B|\b/),n.end&&(a.endRe=t(a.end)),a.terminatorEnd=p(a.end)||``,n.endsWithParent&&r.terminatorEnd&&(a.terminatorEnd+=(n.end?`|`:``)+r.terminatorEnd)),n.illegal&&(a.illegalRe=t(n.illegal)),n.contains||=[],n.contains=[].concat(...n.contains.map(function(e){return Te(e===`self`?n:e)})),n.contains.forEach(function(e){o(e,a)}),n.starts&&o(n.starts,r),a.matcher=i(a),a}if(e.compilerExtensions||=[],e.contains&&e.contains.includes(`self`))throw Error("ERR: contains `self` is not supported at the top-level of a language.  See documentation.");return e.classNameAliases=a(e.classNameAliases||{}),o(e)}function we(e){return e?e.endsWithParent||we(e.starts):!1}function Te(e){return e.variants&&!e.cachedVariants&&(e.cachedVariants=e.variants.map(function(t){return a(e,{variants:null},t)})),e.cachedVariants?e.cachedVariants:we(e)?a(e,{starts:e.starts?a(e.starts):null}):Object.isFrozen(e)?a(e):e}var Ee=`11.12.0`,De=class extends Error{constructor(e,t){super(e),this.name=`HTMLInjectionError`,this.html=t}},Oe=i,ke=a,Ae=Symbol(`nomatch`),je=7,Me=function(e){let t=Object.create(null),i=Object.create(null),a=[],o=!0,s=`Could not find the language '{}', did you forget to load/include a language module?`,c={disableAutodetect:!0,name:`Plain text`,contains:[]},l={ignoreUnescapedHTML:!1,throwUnescapedHTML:!1,noHighlightRe:/^(no-?highlight)$/i,languageDetectRe:/\blang(?:uage)?-([\w-]+)\b/i,classPrefix:`hljs-`,cssSelector:`pre code`,languages:null,__emitter:f};function u(e){return l.noHighlightRe.test(e)}function d(e){let t=e.className+` `;t+=e.parentNode?e.parentNode.className:``;let n=l.languageDetectRe.exec(t);if(n){let t=N(n[1]);return t||(he(s.replace(`{}`,n[1])),he(`Falling back to no-highlight mode for this block.`,e)),t?n[1]:`no-highlight`}return t.split(/\s+/).find(e=>u(e)||N(e))}function p(e,t,n){let r=``,i=``;typeof t==`object`?(r=e,n=t.ignoreIllegals,i=t.language):(ge(`10.7.0`,`highlight(lang, code, ...args) has been deprecated.`),ge(`10.7.0`,`Please use highlight(code, options) instead.
https://github.com/highlightjs/highlight.js/issues/2277`),i=e,r=t),n===void 0&&(n=!0);let a={code:r,language:i};te(`before:highlight`,a);let o=a.result?a.result:v(a.language,a.code,n);return o.code=a.code,te(`after:highlight`,o),o}function v(e,n,i,a){let c=Object.create(null);function u(e,t){return e.keywords[t]}function d(){if(!A.keywords){M.addText(P);return}let e=0;A.keywordPatternRe.lastIndex=0;let t=A.keywordPatternRe.exec(P),n=``;for(;t;){n+=P.substring(e,t.index);let r=D.case_insensitive?t[0].toLowerCase():t[0],i=u(A,r);if(i){let[e,a]=i;if(M.addText(n),n=``,c[r]=(c[r]||0)+1,c[r]<=je&&(F+=a),e.startsWith(`_`))n+=t[0];else{let n=D.classNameAliases[e]||e;m(t[0],n)}}else n+=t[0];e=A.keywordPatternRe.lastIndex,t=A.keywordPatternRe.exec(P)}n+=P.substring(e),M.addText(n)}function f(){if(P===``)return;let e=null;if(typeof A.subLanguage==`string`){if(!t[A.subLanguage]){M.addText(P);return}e=v(A.subLanguage,P,!0,j[A.subLanguage]),j[A.subLanguage]=e._top}else e=S(P,A.subLanguage.length?A.subLanguage:null);A.relevance>0&&(F+=e.relevance),M.__addSublanguage(e._emitter,e.language)}function p(){A.subLanguage==null?d():f(),P=``}function m(e,t){e!==``&&(M.startScope(t),M.addText(e),M.endScope())}function h(e,t){let n=1,r=t.length-1;for(;n<=r;){if(!e._emit[n]){n++;continue}let r=D.classNameAliases[e[n]]||e[n],i=t[n];r?m(i,r):(P=i,d(),P=``),n++}}function g(e,t){return e.scope&&typeof e.scope==`string`&&M.openNode(D.classNameAliases[e.scope]||e.scope),e.beginScope&&(e.beginScope._wrap?(m(P,D.classNameAliases[e.beginScope._wrap]||e.beginScope._wrap),P=``):e.beginScope._multi&&(h(e.beginScope,t),P=``)),A=Object.create(e,{parent:{value:A}}),A}function _(e,t,n){let i=x(e.endRe,n);if(i){if(e[`on:end`]){let n=new r(e);e[`on:end`](t,n),n.isMatchIgnored&&(i=!1)}if(i){for(;e.endsParent&&e.parent;)e=e.parent;return e}}if(e.endsWithParent)return _(e.parent,t,n)}function y(e){return A.matcher.regexIndex===0?(P+=e[0],1):(ee=!0,0)}function b(e){let t=e[0],n=e.rule,i=new r(n),a=[n.__beforeBegin,n[`on:begin`]];for(let n of a)if(n&&(n(e,i),i.isMatchIgnored))return y(t);return n.skip?P+=t:(n.excludeBegin&&(P+=t),p(),!n.returnBegin&&!n.excludeBegin&&(P=t)),g(n,e),n.returnBegin?0:t.length}function C(e){let t=e[0],r=n.substring(e.index),i=_(A,e,r);if(!i)return Ae;let a=A;A.endScope&&A.endScope._wrap?(p(),m(t,A.endScope._wrap)):A.endScope&&A.endScope._multi?(p(),h(A.endScope,e)):a.skip?P+=t:(a.returnEnd||a.excludeEnd||(P+=t),p(),a.excludeEnd&&(P=t));do A.scope&&M.closeNode(),!A.skip&&!A.subLanguage&&(F+=A.relevance),A=A.parent;while(A!==i.parent);return i.starts&&g(i.starts,e),a.returnEnd?0:t.length}function w(){let e=[];for(let t=A;t!==D;t=t.parent)t.scope&&e.unshift(t.scope);e.forEach(e=>M.openNode(e))}let T={};function E(t,r){let a=r&&r[0];if(P+=t,a==null)return p(),0;if(T.type===`begin`&&r.type===`end`&&T.index===r.index&&a===``){if(P+=n.slice(r.index,r.index+1),!o){let t=Error(`0 width match regex (${e})`);throw t.languageName=e,t.badRule=T.rule,t}return 1}if(T=r,r.type===`begin`)return b(r);if(r.type===`illegal`&&!i){let e=Error(`Illegal lexeme "`+a+`" for mode "`+(A.scope||`<unnamed>`)+`"`);throw e.mode=A,e}if(r.type===`end`){let e=C(r);if(e!==Ae)return e}if(r.type===`illegal`&&a===``)return r.index===n.length||(P+=`
`),1;if(L>1e5&&L>r.index*3)throw Error(`potential infinite loop, way more iterations than matches`);return P+=a,a.length}let D=N(e);if(!D)throw z(s.replace(`{}`,e)),Error(`Unknown language: "`+e+`"`);let O=Ce(D),k=``,A=a||O,j={},M=new l.__emitter(l);w();let P=``,F=0,I=0,L=0,ee=!1;try{if(D.__emitTokens)D.__emitTokens(n,M);else{for(A.matcher.considerAll();;){L++,ee?ee=!1:A.matcher.considerAll(),A.matcher.lastIndex=I;let e=A.matcher.exec(n);if(!e)break;let t=E(n.substring(I,e.index),e);I=e.index+t}E(n.substring(I))}return M.finalize(),k=M.toHTML(),{language:e,value:k,relevance:F,illegal:!1,_emitter:M,_top:A}}catch(t){if(t.message&&t.message.includes(`Illegal`))return{language:e,value:Oe(n),illegal:!0,relevance:0,_illegalBy:{message:t.message,index:I,context:n.slice(I-100,I+100),mode:t.mode,resultSoFar:k},_emitter:M};if(o)return{language:e,value:Oe(n),illegal:!1,relevance:0,errorRaised:t,_emitter:M,_top:A};throw t}}function b(e){let t={value:Oe(e),illegal:!1,relevance:0,_top:c,_emitter:new l.__emitter(l)};return t._emitter.addText(e),t}function S(e,n){n=n||l.languages||Object.keys(t);let r=b(e),i=n.filter(N).filter(F).map(t=>v(t,e,!1));i.unshift(r);let[a,o]=i.sort((e,t)=>{if(e.relevance!==t.relevance)return t.relevance-e.relevance;if(e.language&&t.language){if(N(e.language).supersetOf===t.language)return 1;if(N(t.language).supersetOf===e.language)return-1}return 0}),s=a;return s.secondBest=o,s}function C(e,t,n){let r=t&&i[t]||n;e.classList.add(`hljs`),e.classList.add(`language-${r}`)}function w(e){let t=null,n=d(e);if(u(n))return;if(te(`before:highlightElement`,{el:e,language:n}),e.dataset.highlighted){console.log("Element previously highlighted. To highlight again, first unset `dataset.highlighted`.",e);return}if(e.children.length>0&&(l.ignoreUnescapedHTML||(console.warn(`One of your code blocks includes unescaped HTML. This is a potentially serious security risk.`),console.warn(`https://github.com/highlightjs/highlight.js/wiki/security`),console.warn(`The element with unescaped HTML:`),console.warn(e)),l.throwUnescapedHTML))throw new De(`One of your code blocks includes unescaped HTML.`,e.innerHTML);t=e;let r=t.textContent,i=n?p(r,{language:n,ignoreIllegals:!0}):S(r);e.innerHTML=i.value,e.dataset.highlighted=`yes`,C(e,n,i.language),e.result={language:i.language,re:i.relevance,relevance:i.relevance},i.secondBest&&(e.secondBest={language:i.secondBest.language,relevance:i.secondBest.relevance}),te(`after:highlightElement`,{el:e,result:i,text:r})}function T(e){l=ke(l,e)}let E=()=>{k(),ge(`10.6.0`,`initHighlighting() deprecated.  Use highlightAll() now.`)};function D(){k(),ge(`10.6.0`,`initHighlightingOnLoad() deprecated.  Use highlightAll() now.`)}let O=!1;function k(){function e(){k()}document.readyState===`loading`?(O||window.addEventListener(`DOMContentLoaded`,e,!1),O=!0):document.querySelectorAll(l.cssSelector).forEach(w)}function A(n,r){let i=null;try{i=r(e)}catch(e){if(z(`Language definition for '{}' could not be registered.`.replace(`{}`,n)),o)z(e);else throw e;i=c}i.name||(i.name=n),t[n]=i,i.rawDefinition=r.bind(null,e),i.aliases&&P(i.aliases,{languageName:n})}function j(e){delete t[e];for(let t of Object.keys(i))i[t]===e&&delete i[t]}function M(){return Object.keys(t)}function N(e){return e=(e||``).toLowerCase(),t[e]||t[i[e]]}function P(e,{languageName:t}){typeof e==`string`&&(e=[e]),e.forEach(e=>{i[e.toLowerCase()]=t})}function F(e){let t=N(e);return t&&!t.disableAutodetect}function I(e){e[`before:highlightBlock`]&&!e[`before:highlightElement`]&&(e[`before:highlightElement`]=t=>{e[`before:highlightBlock`](Object.assign({block:t.el},t))}),e[`after:highlightBlock`]&&!e[`after:highlightElement`]&&(e[`after:highlightElement`]=t=>{e[`after:highlightBlock`](Object.assign({block:t.el},t))})}function L(e){I(e),a.push(e)}function ee(e){let t=a.indexOf(e);t!==-1&&a.splice(t,1)}function te(e,t){let n=e;a.forEach(function(e){e[n]&&e[n](t)})}function re(e){return ge(`10.7.0`,`highlightBlock will be removed entirely in v12.0`),ge(`10.7.0`,`Please use highlightElement now.`),w(e)}Object.assign(e,{highlight:p,highlightAuto:S,highlightAll:k,highlightElement:w,highlightBlock:re,configure:T,initHighlighting:E,initHighlightingOnLoad:D,registerLanguage:A,unregisterLanguage:j,listLanguages:M,getLanguage:N,registerAliases:P,autoDetection:F,inherit:ke,addPlugin:L,removePlugin:ee}),e.debugMode=function(){o=!1},e.safeMode=function(){o=!0},e.versionString=Ee,e.regex={concat:_,lookahead:m,either:y,optional:g,anyNumberOfTimes:h};for(let e in ne)typeof ne[e]==`object`&&n(ne[e]);return Object.assign(e,ne),e},Ne=Me({});Ne.newInstance=()=>Me({}),t.exports=Ne,Ne.HighlightJS=Ne,Ne.default=Ne}))()).default;function Rt(e){let t=e.regex,n={},r={begin:/\$\{/,end:/\}/,contains:[`self`,{begin:/:-/,contains:[n]}]};Object.assign(n,{className:`variable`,variants:[{begin:t.concat(/\$[\w\d#@][\w\d_]*/,`(?![\\w\\d])(?![$])`)},r]});let i={className:`subst`,begin:/\$\(/,end:/\)/,contains:[e.BACKSLASH_ESCAPE]},a=e.inherit(e.COMMENT(),{match:[/(^|\s)/,/#.*$/],scope:{2:`comment`}}),o={begin:/<<-?\s*(?=\w+)/,starts:{contains:[e.END_SAME_AS_BEGIN({begin:/(\w+)/,end:/(\w+)/,className:`string`})]}},s={className:`string`,begin:/"/,end:/"/,contains:[e.BACKSLASH_ESCAPE,n,i]};i.contains.push(s);let c={match:/\\"/},l={className:`string`,begin:/'/,end:/'/},u={match:/\\'/},d={begin:/\$?\(\(/,end:/\)\)/,contains:[{begin:/\d+#[0-9a-f]+/,className:`number`},e.NUMBER_MODE,n]},f=e.SHEBANG({binary:`(fish|bash|zsh|sh|csh|ksh|tcsh|dash|scsh)`,relevance:10}),p={className:`function`,begin:/\w[\w\d_]*\s*\(\s*\)\s*\{/,returnBegin:!0,contains:[e.inherit(e.TITLE_MODE,{begin:/\w[\w\d_]*/})],relevance:0},m=[`if`,`then`,`else`,`elif`,`fi`,`time`,`for`,`while`,`until`,`in`,`do`,`done`,`case`,`esac`,`coproc`,`function`,`select`],h=[`true`,`false`],g={match:/(\/[a-z._-]+)+/},_=[`break`,`cd`,`continue`,`eval`,`exec`,`exit`,`export`,`getopts`,`hash`,`pwd`,`readonly`,`return`,`shift`,`test`,`times`,`trap`,`umask`,`unset`],v=[`alias`,`bind`,`builtin`,`caller`,`command`,`declare`,`echo`,`enable`,`help`,`let`,`local`,`logout`,`mapfile`,`printf`,`read`,`readarray`,`source`,`sudo`,`type`,`typeset`,`ulimit`,`unalias`],y=`autoload.bg.bindkey.bye.cap.chdir.clone.comparguments.compcall.compctl.compdescribe.compfiles.compgroups.compquote.comptags.comptry.compvalues.dirs.disable.disown.echotc.echoti.emulate.fc.fg.float.functions.getcap.getln.history.integer.jobs.kill.limit.log.noglob.popd.print.pushd.pushln.rehash.sched.setcap.setopt.stat.suspend.ttyctl.unfunction.unhash.unlimit.unsetopt.vared.wait.whence.where.which.zcompile.zformat.zftp.zle.zmodload.zparseopts.zprof.zpty.zregexparse.zsocket.zstyle.ztcp`.split(`.`),b=`chcon.chgrp.chown.chmod.cp.dd.df.dir.dircolors.ln.ls.mkdir.mkfifo.mknod.mktemp.mv.realpath.rm.rmdir.shred.sync.touch.truncate.vdir.b2sum.base32.base64.cat.cksum.comm.csplit.cut.expand.fmt.fold.head.join.md5sum.nl.numfmt.od.paste.ptx.pr.sha1sum.sha224sum.sha256sum.sha384sum.sha512sum.shuf.sort.split.sum.tac.tail.tr.tsort.unexpand.uniq.wc.arch.basename.chroot.date.dirname.du.echo.env.expr.factor.groups.hostid.id.link.logname.nice.nohup.nproc.pathchk.pinky.printenv.printf.pwd.readlink.runcon.seq.sleep.stat.stdbuf.stty.tee.test.timeout.tty.uname.unlink.uptime.users.who.whoami.yes`.split(`.`);return{name:`Bash`,aliases:[`sh`,`zsh`],keywords:{$pattern:/\b[a-z][a-z0-9._-]+\b/,keyword:m,literal:h,built_in:[..._,...v,`set`,`shopt`,...y,...b]},contains:[f,e.SHEBANG(),p,d,a,o,g,s,c,l,u,n]}}function zt(e){let t=e.regex,n=e.COMMENT(`//`,`$`,{contains:[{begin:/\\\n/}]}),r=`[a-zA-Z_]\\w*::`,i=`(decltype\\(auto\\)|`+t.optional(r)+`[a-zA-Z_]\\w*`+t.optional(`<[^<>]+>`)+`)`,a={className:`type`,variants:[{begin:`\\b[a-z\\d_]*_t\\b`},{match:t.concat(/\batomic_/,t.either(`bool`,`char`,`schar`,`uchar`,`short`,`ushort`,`int`,`uint`,`long`,`ulong`,`llong`,`ullong`,`char16_t`,`char32_t`,`wchar_t`,`int_least8_t`,`uint_least8_t`,`int_least16_t`,`uint_least16_t`,`int_least32_t`,`uint_least32_t`,`int_least64_t`,`uint_least64_t`,`int_fast8_t`,`uint_fast8_t`,`int_fast16_t`,`uint_fast16_t`,`int_fast32_t`,`uint_fast32_t`,`int_fast64_t`,`uint_fast64_t`,`intptr_t`,`uintptr_t`,`size_t`,`ptrdiff_t`,`intmax_t`,`uintmax_t`),/\b/)}]},o={className:`string`,variants:[{begin:`(u8?|U|L)?"`,end:`"`,illegal:`\\n`,contains:[e.BACKSLASH_ESCAPE]},{begin:`(u8?|U|L)?'(\\\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4,8}|[0-7]{3}|\\S)|.)`,end:`'`,illegal:`.`},e.END_SAME_AS_BEGIN({begin:/(?:u8?|U|L)?R"([^()\\\s"]{0,16})\(/,end:/\)([^()\\\s"]{0,16})"/})]},s={className:`number`,variants:[{match:/\b(0b[01']+)/},{match:/(-?)\b([\d']+(\.[\d']*)?|\.[\d']+)((ll|LL|l|L)(u|U)?|(u|U)(ll|LL|l|L)?|f|F|b|B)/},{match:/(-?)\b(0[xX][a-fA-F0-9]+(?:'[a-fA-F0-9]+)*(?:\.[a-fA-F0-9]*(?:'[a-fA-F0-9]*)*)?(?:[pP][-+]?[0-9]+)?(l|L)?(u|U)?)/},{match:/(-?)\b\d+(?:'\d+)*(?:\.\d*(?:'\d*)*)?(?:[eE][-+]?\d+)?/}],relevance:0},c={scope:`meta`,begin:/#\s*include\b/,end:/$/,keywords:{keyword:`include`},contains:[{begin:/\\\n/},o,{scope:`string`,begin:/<.*?>/},n,e.C_BLOCK_COMMENT_MODE]},l={className:`meta`,begin:/#\s*[a-z]+\b/,end:/$/,keywords:{keyword:`if else elif endif define undef warning error line pragma _Pragma ifdef ifndef elifdef elifndef include`},contains:[{begin:/\\\n/,relevance:0},e.inherit(o,{className:`string`}),n,e.C_BLOCK_COMMENT_MODE]},u=[c,l],d={className:`title`,begin:t.optional(r)+e.IDENT_RE,relevance:0},f=t.optional(r)+e.IDENT_RE+`\\s*\\(`,p={keyword:`asm.auto.break.case.continue.default.do.else.enum.extern.for.fortran.goto.if.inline.register.restrict.return.sizeof.typeof.typeof_unqual.struct.switch.typedef.union.volatile.while._Alignas._Alignof._Atomic._Generic._Noreturn._Static_assert._Thread_local.alignas.alignof.noreturn.static_assert.thread_local._Pragma`.split(`.`),type:`float.double.signed.unsigned.int.short.long.char.void._Bool._BitInt._Complex._Imaginary._Decimal32._Decimal64._Decimal96._Decimal128._Decimal64x._Decimal128x._Float16._Float32._Float64._Float128._Float32x._Float64x._Float128x.const.static.constexpr.complex.bool.imaginary`.split(`.`),literal:`true false NULL`,built_in:`std string wstring cin cout cerr clog stdin stdout stderr stringstream istringstream ostringstream auto_ptr deque list queue stack vector map set pair bitset multiset multimap unordered_set unordered_map unordered_multiset unordered_multimap priority_queue make_pair array shared_ptr abort terminate abs acos asin atan2 atan calloc ceil cosh cos exit exp fabs floor fmod fprintf fputs free frexp fscanf future isalnum isalpha iscntrl isdigit isgraph islower isprint ispunct isspace isupper isxdigit tolower toupper labs ldexp log10 log malloc realloc memchr memcmp memcpy memset modf pow printf putchar puts scanf sinh sin snprintf sprintf sqrt sscanf strcat strchr strcmp strcpy strcspn strlen strncat strncmp strncpy strpbrk strrchr strspn strstr tanh tan vfprintf vprintf vsprintf endl initializer_list unique_ptr`},m=[...u,a,n,e.C_BLOCK_COMMENT_MODE,s,o],h={variants:[{begin:/=/,end:/;/},{begin:/\(/,end:/\)/},{beginKeywords:`new throw return else`,end:/;/}],keywords:p,contains:m.concat([{begin:/\(/,end:/\)/,keywords:p,contains:m.concat([`self`]),relevance:0}]),relevance:0},g={begin:`(`+i+`[\\*&\\s]+){1,12}`+f,returnBegin:!0,end:/[{;=]/,excludeEnd:!0,keywords:p,illegal:/[^\w\s\*&:<>.]/,contains:[{begin:`decltype\\(auto\\)`,keywords:p,relevance:0},{begin:f,returnBegin:!0,contains:[e.inherit(d,{className:`title.function`})],relevance:0},{relevance:0,match:/,/},{className:`params`,begin:/\(/,end:/\)/,keywords:p,relevance:0,contains:[n,e.C_BLOCK_COMMENT_MODE,o,s,a,{begin:/\(/,end:/\)/,keywords:p,relevance:0,contains:[`self`,n,e.C_BLOCK_COMMENT_MODE,o,s,a]}]},a,n,e.C_BLOCK_COMMENT_MODE,...u]};return{name:`C`,aliases:[`h`],keywords:p,disableAutodetect:!0,illegal:`</`,contains:[].concat(h,g,m,[...u,{begin:e.IDENT_RE+`::`,keywords:p},{className:`class`,beginKeywords:`enum class struct union`,end:/[{;:<>=]/,contains:[{beginKeywords:`final class struct`},e.TITLE_MODE]}]),exports:{preprocessor:l,strings:o,keywords:p}}}function Bt(e){let t=e.regex,n=e.COMMENT(`//`,`$`,{contains:[{begin:/\\\n/}]}),r=`[a-zA-Z_]\\w*::`,i=`(?!struct)(decltype\\(auto\\)|`+t.optional(r)+`[a-zA-Z_]\\w*`+t.optional(`<[^<>]+>`)+`)`,a={className:`type`,begin:`\\b[a-z\\d_]*_t\\b`},o={className:`string`,variants:[{begin:`(u8?|U|L)?"`,end:`"`,illegal:`\\n`,contains:[e.BACKSLASH_ESCAPE]},{begin:`(u8?|U|L)?'(\\\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4,8}|[0-7]{3}|\\S)|.)`,end:`'`,illegal:`.`},e.END_SAME_AS_BEGIN({begin:/(?:u8?|U|L)?R"([^()\\\s"]{0,16})\(/,end:/\)([^()\\\s"]{0,16})"/})]},s={className:`number`,variants:[{begin:`[+-]?(?:(?:\\b[0-9](?:'?[0-9])*\\.(?:[0-9](?:'?[0-9])*)?|\\.[0-9](?:'?[0-9])*)(?:[Ee][+-]?[0-9](?:'?[0-9])*)?|\\b[0-9](?:'?[0-9])*[Ee][+-]?[0-9](?:'?[0-9])*|\\b0[Xx](?:[0-9A-Fa-f](?:'?[0-9A-Fa-f])*(?:\\.(?:[0-9A-Fa-f](?:'?[0-9A-Fa-f])*)?)?|\\.[0-9A-Fa-f](?:'?[0-9A-Fa-f])*)[Pp][+-]?[0-9](?:'?[0-9])*)(?:[Ff](?:16|32|64|128)?|(BF|bf)16|[Ll]|)`},{begin:`[+-]?\\b(?:0[Bb][01](?:'?[01])*|0[Xx][0-9A-Fa-f](?:'?[0-9A-Fa-f])*|0(?:'?[0-7])*|[1-9](?:'?[0-9])*)(?:[Uu](?:LL?|ll?)|[Uu][Zz]?|(?:LL?|ll?)[Uu]?|[Zz][Uu]|)`}],relevance:0},c=[{scope:`meta`,begin:/#\s*include\b/,end:/$/,keywords:{keyword:`include`},contains:[{begin:/\\\n/},o,{scope:`string`,begin:/<.*?>/},n,e.C_BLOCK_COMMENT_MODE]},{className:`meta`,begin:/#\s*[a-z]+\b/,end:/$/,keywords:{keyword:`if else elif endif define undef warning error line pragma _Pragma ifdef ifndef include`},contains:[{begin:/\\\n/,relevance:0},e.inherit(o,{className:`string`}),n,e.C_BLOCK_COMMENT_MODE]}],l={className:`title`,begin:t.optional(r)+e.IDENT_RE,relevance:0},u=t.optional(r)+e.IDENT_RE+`\\s*\\(`,d=`alignas.alignof.and.and_eq.asm.atomic_cancel.atomic_commit.atomic_noexcept.auto.bitand.bitor.break.case.catch.class.co_await.co_return.co_yield.compl.concept.const_cast|10.consteval.constexpr.constinit.continue.decltype.default.delete.do.dynamic_cast|10.else.enum.explicit.export.extern.false.final.for.friend.goto.if.import.inline.module.mutable.namespace.new.noexcept.not.not_eq.nullptr.operator.or.or_eq.override.private.protected.public.reflexpr.register.reinterpret_cast|10.requires.return.sizeof.static_assert.static_cast|10.struct.switch.synchronized.template.this.thread_local.throw.transaction_safe.transaction_safe_dynamic.true.try.typedef.typeid.typename.union.using.virtual.volatile.while.xor.xor_eq`.split(`.`),f=[`bool`,`char`,`char16_t`,`char32_t`,`char8_t`,`double`,`float`,`int`,`long`,`short`,`void`,`wchar_t`,`unsigned`,`signed`,`const`,`static`],p=`any.auto_ptr.barrier.binary_semaphore.bitset.complex.condition_variable.condition_variable_any.counting_semaphore.deque.false_type.flat_map.flat_set.future.imaginary.initializer_list.istringstream.jthread.latch.lock_guard.multimap.multiset.mutex.optional.ostringstream.packaged_task.pair.promise.priority_queue.queue.recursive_mutex.recursive_timed_mutex.scoped_lock.set.shared_future.shared_lock.shared_mutex.shared_timed_mutex.shared_ptr.stack.string_view.stringstream.timed_mutex.thread.true_type.tuple.unique_lock.unique_ptr.unordered_map.unordered_multimap.unordered_multiset.unordered_set.variant.vector.weak_ptr.wstring.wstring_view`.split(`.`),m=`abort.abs.acos.apply.as_const.asin.atan.atan2.calloc.ceil.cerr.cin.clog.cos.cosh.cout.declval.endl.exchange.exit.exp.fabs.floor.fmod.forward.fprintf.fputs.free.frexp.fscanf.future.invoke.isalnum.isalpha.iscntrl.isdigit.isgraph.islower.isprint.ispunct.isspace.isupper.isxdigit.labs.launder.ldexp.log.log10.make_pair.make_shared.make_shared_for_overwrite.make_tuple.make_unique.malloc.memchr.memcmp.memcpy.memset.modf.move.pow.printf.putchar.puts.realloc.scanf.sin.sinh.snprintf.sprintf.sqrt.sscanf.std.stderr.stdin.stdout.strcat.strchr.strcmp.strcpy.strcspn.strlen.strncat.strncmp.strncpy.strpbrk.strrchr.strspn.strstr.swap.tan.tanh.terminate.to_underlying.tolower.toupper.vfprintf.visit.vprintf.vsprintf`.split(`.`),h={type:f,keyword:d,literal:[`NULL`,`false`,`nullopt`,`nullptr`,`true`],built_in:[`_Pragma`],_type_hints:p},g={className:`function.dispatch`,relevance:0,keywords:{_hint:m},begin:t.concat(/\b/,`(?!${d.join(`|`)})`,e.IDENT_RE,t.lookahead(/(<[^<>]+>|)\s*\(/))},_=[g,...c,a,n,e.C_BLOCK_COMMENT_MODE,s,o],v={variants:[{begin:/=/,end:/;/},{begin:/\(/,end:/\)/},{beginKeywords:`new throw return else`,end:/;/}],keywords:h,contains:_.concat([{begin:/\(/,end:/\)/,keywords:h,contains:_.concat([`self`]),relevance:0}]),relevance:0},y={className:`function`,begin:`(`+i+`[\\*&\\s]+){1,12}`+u,returnBegin:!0,end:/[{;=]/,excludeEnd:!0,keywords:h,illegal:/[^\w\s\*&:<>.]/,contains:[{begin:`decltype\\(auto\\)`,keywords:h,relevance:0},{begin:u,returnBegin:!0,contains:[l],relevance:0},{begin:/::/,relevance:0},{begin:/:/,endsWithParent:!0,contains:[o,s]},{relevance:0,match:/,/},{className:`params`,begin:/\(/,end:/\)/,keywords:h,relevance:0,contains:[n,e.C_BLOCK_COMMENT_MODE,o,s,a,{begin:/\(/,end:/\)/,keywords:h,relevance:0,contains:[`self`,n,e.C_BLOCK_COMMENT_MODE,o,s,a]}]},a,n,e.C_BLOCK_COMMENT_MODE,...c]};return{name:`C++`,aliases:[`cc`,`c++`,`h++`,`hpp`,`hh`,`hxx`,`cxx`],keywords:h,illegal:`</`,classNameAliases:{"function.dispatch":`built_in`},contains:[].concat(v,y,g,_,[...c,{begin:`\\b(deque|list|queue|priority_queue|pair|stack|vector|map|set|bitset|multiset|multimap|unordered_map|unordered_set|unordered_multiset|unordered_multimap|array|tuple|optional|variant|function|flat_map|flat_set)\\s*<(?!<)`,end:`>`,keywords:h,contains:[`self`,a]},{begin:e.IDENT_RE+`::`,keywords:h},{match:[/\b(?:enum(?:\s+(?:class|struct))?|class|struct|union)/,/\s+/,/\w+/],className:{1:`keyword`,3:`title.class`}}])}}function Vt(e){let t=[`bool`,`byte`,`char`,`decimal`,`delegate`,`double`,`dynamic`,`enum`,`float`,`int`,`long`,`nint`,`nuint`,`object`,`sbyte`,`short`,`string`,`ulong`,`uint`,`ushort`],n=[`public`,`private`,`protected`,`static`,`internal`,`protected`,`abstract`,`async`,`extern`,`override`,`unsafe`,`virtual`,`new`,`sealed`,`partial`],r={keyword:`abstract.as.base.break.case.catch.class.const.continue.do.else.event.explicit.extern.finally.fixed.for.foreach.goto.if.implicit.in.interface.internal.is.lock.namespace.new.operator.out.override.params.private.protected.public.readonly.record.ref.return.scoped.sealed.sizeof.stackalloc.static.struct.switch.this.throw.try.typeof.unchecked.unsafe.using.virtual.void.volatile.while`.split(`.`).concat(`add.alias.and.ascending.args.async.await.by.descending.dynamic.equals.file.from.get.global.group.init.into.join.let.nameof.not.notnull.on.or.orderby.partial.record.remove.required.scoped.select.set.unmanaged.value|0.var.when.where.with.yield`.split(`.`)),built_in:t,literal:[`default`,`false`,`null`,`true`]},i=e.inherit(e.TITLE_MODE,{begin:`[a-zA-Z](\\.?\\w)*`}),a=`([uU][lL]?|[lL][uU]?)?`,o={className:`number`,variants:[{begin:`\\b0[bB]_*[01](_*[01])*`+a},{begin:`(-?)\\b0[xX]_*[a-fA-F0-9](_*[a-fA-F0-9])*`+a},{begin:`(-?)(\\b\\d(_*\\d)*(\\.(\\d(_*\\d)*)?)?|\\.\\d(_*\\d)*)([eE][-+]?\\d(_*\\d)*)?([fFdDmM]|[uU][lL]?|[lL][uU]?)?`}],relevance:0},s={className:`string`,begin:/"""("*)(?!")(.|\n)*?"""\1/,relevance:1},c={className:`string`,begin:`@"`,end:`"`,contains:[{begin:`""`}]},l=e.inherit(c,{illegal:/\n/}),u={className:`subst`,begin:/\{/,end:/\}/,keywords:r},d=e.inherit(u,{illegal:/\n/}),f={className:`string`,begin:/\$"/,end:`"`,illegal:/\n/,contains:[{begin:/\{\{/},{begin:/\}\}/},e.BACKSLASH_ESCAPE,d]},p={className:`string`,begin:/\$@"/,end:`"`,contains:[{begin:/\{\{/},{begin:/\}\}/},{begin:`""`},u]},m=e.inherit(p,{illegal:/\n/,contains:[{begin:/\{\{/},{begin:/\}\}/},{begin:`""`},d]});u.contains=[p,f,c,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,o,e.C_BLOCK_COMMENT_MODE],d.contains=[m,f,l,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,o,e.inherit(e.C_BLOCK_COMMENT_MODE,{illegal:/\n/})];let h={variants:[s,p,f,c,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE]},g={begin:`<`,end:`>`,contains:[{beginKeywords:`in out`},i]},_=e.IDENT_RE+`(<`+e.IDENT_RE+`(\\s*,\\s*`+e.IDENT_RE+`)*>)?(\\[\\])?`,v={begin:`@`+e.IDENT_RE,relevance:0};return{name:`C#`,aliases:[`cs`,`c#`],keywords:r,illegal:/::/,contains:[e.COMMENT(`///`,`$`,{returnBegin:!0,contains:[{className:`doctag`,variants:[{begin:`///`,relevance:0},{begin:`<!--|-->`},{begin:`</?`,end:`>`}]}]}),e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,{className:`meta`,begin:`#`,end:`$`,keywords:{keyword:`if else elif endif define undef warning error line region endregion pragma checksum`}},h,o,{beginKeywords:`class interface`,relevance:0,end:/[{;=]/,illegal:/[^\s:,]/,contains:[{beginKeywords:`where class`},i,g,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE]},{beginKeywords:`namespace`,relevance:0,end:/[{;=]/,illegal:/[^\s:]/,contains:[i,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE]},{beginKeywords:`record`,relevance:0,end:/[{;=]/,illegal:/[^\s:]/,contains:[i,g,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE]},{className:`meta`,begin:`^\\s*\\[(?=[\\w])`,excludeBegin:!0,end:`\\]`,excludeEnd:!0,contains:[{className:`string`,begin:/"/,end:/"/}]},{beginKeywords:`new return throw await else`,relevance:0},{className:`function`,begin:`(`+_+`\\s+)+`+e.IDENT_RE+`\\s*(<[^=]+>\\s*)?\\(`,returnBegin:!0,end:/\s*[{;=]/,excludeEnd:!0,keywords:r,contains:[{beginKeywords:n.join(` `),relevance:0},{begin:e.IDENT_RE+`\\s*(<[^=]+>\\s*)?\\(`,returnBegin:!0,contains:[e.TITLE_MODE,g],relevance:0},{match:/\(\)/},{className:`params`,begin:/\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:r,relevance:0,contains:[h,o,e.C_BLOCK_COMMENT_MODE]},e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE]},v]}}var Ht=e=>({IMPORTANT:{scope:`meta`,begin:`!important`},BLOCK_COMMENT:e.C_BLOCK_COMMENT_MODE,HEXCOLOR:{scope:`number`,begin:/#(([0-9a-fA-F]{3,4})|(([0-9a-fA-F]{2}){3,4}))\b/},UNICODE_RANGE:{scope:`number`,begin:/\b[Uu]\+[0-9A-Fa-f][0-9A-Fa-f?]{0,5}(-[0-9A-Fa-f][0-9A-Fa-f]{0,5})?/},FUNCTION_DISPATCH:{className:`built_in`,begin:/[\w-]+(?=\()/},ATTRIBUTE_SELECTOR_MODE:{scope:`selector-attr`,begin:/\[/,end:/\]/,illegal:`$`,contains:[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE]},CSS_NUMBER_MODE:{scope:`number`,begin:e.NUMBER_RE+`(%|em|ex|ch|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc|px|deg|grad|rad|turn|s|ms|Hz|kHz|dpi|dpcm|dppx)?`,relevance:0},CSS_VARIABLE:{className:`attr`,begin:/--[A-Za-z_][A-Za-z0-9_-]*/}}),Ut=`a.abbr.address.article.aside.audio.b.blockquote.body.button.canvas.caption.cite.code.dd.del.details.dfn.div.dl.dt.em.fieldset.figcaption.figure.footer.form.h1.h2.h3.h4.h5.h6.header.hgroup.html.i.iframe.img.input.ins.kbd.label.legend.li.main.mark.menu.nav.object.ol.optgroup.option.p.picture.q.quote.samp.section.select.source.span.strong.summary.sup.table.tbody.td.textarea.tfoot.th.thead.time.tr.ul.var.video`.split(`.`),Wt=`defs.g.marker.mask.pattern.svg.switch.symbol.feBlend.feColorMatrix.feComponentTransfer.feComposite.feConvolveMatrix.feDiffuseLighting.feDisplacementMap.feFlood.feGaussianBlur.feImage.feMerge.feMorphology.feOffset.feSpecularLighting.feTile.feTurbulence.linearGradient.radialGradient.stop.circle.ellipse.image.line.path.polygon.polyline.rect.text.use.textPath.tspan.foreignObject.clipPath`.split(`.`),Gt=[...Ut,...Wt],Kt=`any-hover.any-pointer.aspect-ratio.color.color-gamut.color-index.device-aspect-ratio.device-height.device-width.display-mode.forced-colors.grid.height.hover.inverted-colors.monochrome.orientation.overflow-block.overflow-inline.pointer.prefers-color-scheme.prefers-contrast.prefers-reduced-motion.prefers-reduced-transparency.resolution.scan.scripting.update.width.min-width.max-width.min-height.max-height`.split(`.`).sort().reverse(),qt=`active.any-link.blank.checked.current.default.defined.dir.disabled.drop.empty.enabled.first.first-child.first-of-type.fullscreen.future.focus.focus-visible.focus-within.has.host.host-context.hover.indeterminate.in-range.invalid.is.lang.last-child.last-of-type.left.link.local-link.not.nth-child.nth-col.nth-last-child.nth-last-col.nth-last-of-type.nth-of-type.only-child.only-of-type.optional.out-of-range.past.placeholder-shown.read-only.read-write.required.right.root.scope.target.target-within.user-invalid.valid.visited.where`.split(`.`).sort().reverse(),Jt=[`after`,`backdrop`,`before`,`cue`,`cue-region`,`first-letter`,`first-line`,`grammar-error`,`marker`,`part`,`placeholder`,`selection`,`slotted`,`spelling-error`].sort().reverse(),Yt=`accent-color.align-content.align-items.align-self.alignment-baseline.all.anchor-name.animation.animation-composition.animation-delay.animation-direction.animation-duration.animation-fill-mode.animation-iteration-count.animation-name.animation-play-state.animation-range.animation-range-end.animation-range-start.animation-timeline.animation-timing-function.appearance.aspect-ratio.backdrop-filter.backface-visibility.background.background-attachment.background-blend-mode.background-clip.background-color.background-image.background-origin.background-position.background-position-x.background-position-y.background-repeat.background-size.baseline-shift.block-size.border.border-block.border-block-color.border-block-end.border-block-end-color.border-block-end-style.border-block-end-width.border-block-start.border-block-start-color.border-block-start-style.border-block-start-width.border-block-style.border-block-width.border-bottom.border-bottom-color.border-bottom-left-radius.border-bottom-right-radius.border-bottom-style.border-bottom-width.border-collapse.border-color.border-end-end-radius.border-end-start-radius.border-image.border-image-outset.border-image-repeat.border-image-slice.border-image-source.border-image-width.border-inline.border-inline-color.border-inline-end.border-inline-end-color.border-inline-end-style.border-inline-end-width.border-inline-start.border-inline-start-color.border-inline-start-style.border-inline-start-width.border-inline-style.border-inline-width.border-left.border-left-color.border-left-style.border-left-width.border-radius.border-right.border-right-color.border-right-style.border-right-width.border-spacing.border-start-end-radius.border-start-start-radius.border-style.border-top.border-top-color.border-top-left-radius.border-top-right-radius.border-top-style.border-top-width.border-width.bottom.box-align.box-decoration-break.box-direction.box-flex.box-flex-group.box-lines.box-ordinal-group.box-orient.box-pack.box-shadow.box-sizing.break-after.break-before.break-inside.caption-side.caret-color.clear.clip.clip-path.clip-rule.color.color-interpolation.color-interpolation-filters.color-profile.color-rendering.color-scheme.column-count.column-fill.column-gap.column-rule.column-rule-color.column-rule-style.column-rule-width.column-span.column-width.columns.contain.contain-intrinsic-block-size.contain-intrinsic-height.contain-intrinsic-inline-size.contain-intrinsic-size.contain-intrinsic-width.container.container-name.container-type.content.content-visibility.corner-bottom-left-shape.corner-bottom-right-shape.corner-shape.corner-top-left-shape.corner-top-right-shape.counter-increment.counter-reset.counter-set.cue.cue-after.cue-before.cursor.cx.cy.direction.display.dominant-baseline.empty-cells.enable-background.field-sizing.fill.fill-opacity.fill-rule.filter.flex.flex-basis.flex-direction.flex-flow.flex-grow.flex-shrink.flex-wrap.float.flood-color.flood-opacity.flow.font.font-display.font-family.font-feature-settings.font-kerning.font-language-override.font-optical-sizing.font-palette.font-size.font-size-adjust.font-smooth.font-smoothing.font-stretch.font-style.font-synthesis.font-synthesis-position.font-synthesis-small-caps.font-synthesis-style.font-synthesis-weight.font-variant.font-variant-alternates.font-variant-caps.font-variant-east-asian.font-variant-emoji.font-variant-ligatures.font-variant-numeric.font-variant-position.font-variation-settings.font-weight.forced-color-adjust.gap.glyph-orientation-horizontal.glyph-orientation-vertical.grid.grid-area.grid-auto-columns.grid-auto-flow.grid-auto-rows.grid-column.grid-column-end.grid-column-start.grid-gap.grid-row.grid-row-end.grid-row-start.grid-template.grid-template-areas.grid-template-columns.grid-template-rows.hanging-punctuation.height.hyphenate-character.hyphenate-limit-chars.hyphens.icon.image-orientation.image-rendering.image-resolution.ime-mode.initial-letter.initial-letter-align.inline-size.inset.inset-area.inset-block.inset-block-end.inset-block-start.inset-inline.inset-inline-end.inset-inline-start.isolation.justify-content.justify-items.justify-self.kerning.left.letter-spacing.lighting-color.line-break.line-height.line-height-step.list-style.list-style-image.list-style-position.list-style-type.margin.margin-block.margin-block-end.margin-block-start.margin-bottom.margin-inline.margin-inline-end.margin-inline-start.margin-left.margin-right.margin-top.margin-trim.marker.marker-end.marker-mid.marker-start.marks.mask.mask-border.mask-border-mode.mask-border-outset.mask-border-repeat.mask-border-slice.mask-border-source.mask-border-width.mask-clip.mask-composite.mask-image.mask-mode.mask-origin.mask-position.mask-repeat.mask-size.mask-type.masonry-auto-flow.math-depth.math-shift.math-style.max-block-size.max-height.max-inline-size.max-width.min-block-size.min-height.min-inline-size.min-width.mix-blend-mode.nav-down.nav-index.nav-left.nav-right.nav-up.none.normal.object-fit.object-position.offset.offset-anchor.offset-distance.offset-path.offset-position.offset-rotate.opacity.order.orphans.outline.outline-color.outline-offset.outline-style.outline-width.overflow.overflow-anchor.overflow-block.overflow-clip-margin.overflow-inline.overflow-wrap.overflow-x.overflow-y.overlay.overscroll-behavior.overscroll-behavior-block.overscroll-behavior-inline.overscroll-behavior-x.overscroll-behavior-y.padding.padding-block.padding-block-end.padding-block-start.padding-bottom.padding-inline.padding-inline-end.padding-inline-start.padding-left.padding-right.padding-top.page.page-break-after.page-break-before.page-break-inside.paint-order.pause.pause-after.pause-before.perspective.perspective-origin.place-content.place-items.place-self.pointer-events.position.position-anchor.position-visibility.print-color-adjust.quotes.r.resize.rest.rest-after.rest-before.right.rotate.row-gap.ruby-align.ruby-position.scale.scroll-behavior.scroll-margin.scroll-margin-block.scroll-margin-block-end.scroll-margin-block-start.scroll-margin-bottom.scroll-margin-inline.scroll-margin-inline-end.scroll-margin-inline-start.scroll-margin-left.scroll-margin-right.scroll-margin-top.scroll-padding.scroll-padding-block.scroll-padding-block-end.scroll-padding-block-start.scroll-padding-bottom.scroll-padding-inline.scroll-padding-inline-end.scroll-padding-inline-start.scroll-padding-left.scroll-padding-right.scroll-padding-top.scroll-snap-align.scroll-snap-stop.scroll-snap-type.scroll-timeline.scroll-timeline-axis.scroll-timeline-name.scrollbar-color.scrollbar-gutter.scrollbar-width.shape-image-threshold.shape-margin.shape-outside.shape-rendering.speak.speak-as.src.stop-color.stop-opacity.stroke.stroke-dasharray.stroke-dashoffset.stroke-linecap.stroke-linejoin.stroke-miterlimit.stroke-opacity.stroke-width.tab-size.table-layout.text-align.text-align-all.text-align-last.text-anchor.text-combine-upright.text-decoration.text-decoration-color.text-decoration-line.text-decoration-skip.text-decoration-skip-ink.text-decoration-style.text-decoration-thickness.text-emphasis.text-emphasis-color.text-emphasis-position.text-emphasis-style.text-indent.text-justify.text-orientation.text-overflow.text-rendering.text-shadow.text-size-adjust.text-transform.text-underline-offset.text-underline-position.text-wrap.text-wrap-mode.text-wrap-style.timeline-scope.top.touch-action.transform.transform-box.transform-origin.transform-style.transition.transition-behavior.transition-delay.transition-duration.transition-property.transition-timing-function.translate.unicode-bidi.unicode-range.user-modify.user-select.vector-effect.vertical-align.view-timeline.view-timeline-axis.view-timeline-inset.view-timeline-name.view-transition-name.visibility.voice-balance.voice-duration.voice-family.voice-pitch.voice-range.voice-rate.voice-stress.voice-volume.white-space.white-space-collapse.widows.width.will-change.word-break.word-spacing.word-wrap.writing-mode.x.y.z-index.zoom`.split(`.`).sort().reverse();function Xt(e){let t=e.regex,n=Ht(e),r={begin:/-(webkit|moz|ms|o)-(?=[a-z])/},i=/@-?\w[\w]*(-\w+)*/,a=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE];return{name:`CSS`,case_insensitive:!0,illegal:/[=|'\$]/,keywords:{keyframePosition:`from to`},classNameAliases:{keyframePosition:`selector-tag`},contains:[n.BLOCK_COMMENT,r,n.CSS_NUMBER_MODE,{className:`selector-id`,begin:/#[A-Za-z0-9_-]+/,relevance:0},{className:`selector-class`,begin:`\\.[a-zA-Z-][a-zA-Z0-9_-]*`,relevance:0},n.ATTRIBUTE_SELECTOR_MODE,{className:`selector-pseudo`,variants:[{begin:`:(`+qt.join(`|`)+`)`},{begin:`:(:)?(`+Jt.join(`|`)+`)`}]},n.CSS_VARIABLE,{className:`attribute`,begin:`\\b(`+Yt.join(`|`)+`)\\b`},{begin:/:/,end:/[;}{]/,contains:[n.BLOCK_COMMENT,n.HEXCOLOR,n.IMPORTANT,n.CSS_NUMBER_MODE,n.UNICODE_RANGE,...a,{begin:/(url|data-uri)\(/,end:/\)/,relevance:0,keywords:{built_in:`url data-uri`},contains:[...a,{className:`string`,begin:/[^)]/,endsWithParent:!0,excludeEnd:!0}]},n.FUNCTION_DISPATCH]},{begin:t.lookahead(/@/),end:`[{;]`,relevance:0,illegal:/:/,contains:[{className:`keyword`,begin:i},{begin:/\s/,endsWithParent:!0,excludeEnd:!0,relevance:0,keywords:{$pattern:/[a-z-]+/,keyword:`and or not only`,attribute:Kt.join(` `)},contains:[{begin:/[a-z-]+(?=:)/,className:`attribute`},...a,n.CSS_NUMBER_MODE]}]},{className:`selector-tag`,begin:`\\b(`+Gt.join(`|`)+`)\\b`}]}}function Zt(e){let t=e.regex;return{name:`Diff`,aliases:[`patch`],contains:[{className:`meta`,relevance:10,match:t.either(/^@@ +-\d+,\d+ +\+\d+,\d+ +@@/,/^@@ +-\d+ +\+\d+,\d+ +@@/,/^@@ +-\d+,\d+ +\+\d+ +@@/,/^@@ +-\d+ +\+\d+ +@@/,/^\*\*\* +\d+,\d+ +\*\*\*\*$/,/^--- +\d+,\d+ +----$/)},{className:`comment`,variants:[{begin:t.either(/Index: /,/^index/,/={3,}/,/^-{3}/,/^\*{3} /,/^\+{3}/,/^diff --git/),end:/$/},{match:/^\*{15}$/}]},{className:`addition`,begin:/^\+/,end:/$/},{className:`deletion`,begin:/^-/,end:/$/},{className:`addition`,begin:/^!/,end:/$/}]}}function Qt(e){return{name:`Dockerfile`,aliases:[`docker`],case_insensitive:!0,keywords:[`from`,`maintainer`,`expose`,`env`,`arg`,`user`,`onbuild`,`stopsignal`],contains:[e.HASH_COMMENT_MODE,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,e.NUMBER_MODE,{beginKeywords:`run cmd entrypoint volume add copy workdir label healthcheck shell`,starts:{end:/[^\\]$/,subLanguage:`bash`}}],illegal:`</`}}function $t(e){let t={keyword:[`break`,`case`,`chan`,`const`,`continue`,`default`,`defer`,`else`,`fallthrough`,`for`,`func`,`go`,`goto`,`if`,`import`,`interface`,`map`,`package`,`range`,`return`,`select`,`struct`,`switch`,`type`,`var`],type:[`bool`,`byte`,`complex64`,`complex128`,`error`,`float32`,`float64`,`int8`,`int16`,`int32`,`int64`,`string`,`uint8`,`uint16`,`uint32`,`uint64`,`int`,`uint`,`uintptr`,`rune`],literal:[`true`,`false`,`iota`,`nil`],built_in:[`append`,`cap`,`close`,`complex`,`copy`,`imag`,`len`,`make`,`new`,`panic`,`print`,`println`,`real`,`recover`,`delete`]};return{name:`Go`,aliases:[`golang`],keywords:t,illegal:`</`,contains:[e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,{className:`string`,variants:[e.QUOTE_STRING_MODE,e.APOS_STRING_MODE,{begin:"`",end:"`"}]},{className:`number`,variants:[{match:/-?\b0[xX]\.[a-fA-F0-9](_?[a-fA-F0-9])*[pP][+-]?\d(_?\d)*i?/,relevance:0},{match:/-?\b0[xX](_?[a-fA-F0-9])+((\.([a-fA-F0-9](_?[a-fA-F0-9])*)?)?[pP][+-]?\d(_?\d)*)?i?/,relevance:0},{match:/-?\b0[oO](_?[0-7])*i?/,relevance:0},{match:/-?\b0[bB](_?[01])*i?/,relevance:0},{match:/-?\.\d(_?\d)*([eE][+-]?\d(_?\d)*)?i?/,relevance:0},{match:/-?\b\d(_?\d)*(\.(\d(_?\d)*)?)?([eE][+-]?\d(_?\d)*)?i?/,relevance:0}]},{begin:/:=/},{className:`function`,beginKeywords:`func`,end:`\\s*(\\{|$)`,excludeEnd:!0,contains:[e.TITLE_MODE,{className:`params`,begin:/\(/,end:/\)/,endsParent:!0,keywords:t,illegal:/["']/}]}]}}function en(e){let t=e.regex,n={className:`number`,relevance:0,variants:[{begin:/([+-]+)?[\d]+_[\d_]+/},{begin:e.NUMBER_RE}]},r=e.COMMENT();r.variants=[{begin:/;/,end:/$/},{begin:/#/,end:/$/}];let i={className:`variable`,variants:[{begin:/\$[\w\d"][\w\d_]*/},{begin:/\$\{(.*?)\}/}]},a={className:`literal`,begin:/\bon|off|true|false|yes|no\b/},o={className:`string`,contains:[e.BACKSLASH_ESCAPE],variants:[{begin:`'''`,end:`'''`,relevance:10},{begin:`"""`,end:`"""`,relevance:10},{begin:`"`,end:`"`},{begin:`'`,end:`'`}]},s={begin:/\[/,end:/\]/,contains:[r,a,i,o,n,`self`],relevance:0},c=t.either(/[A-Za-z0-9_-]+/,/"(\\"|[^"])*"/,/'[^']*'/);return{name:`TOML, also INI`,aliases:[`toml`],case_insensitive:!0,illegal:/\S/,contains:[r,{className:`section`,begin:/\[+/,end:/\]+/},{begin:t.concat(c,`(\\s*\\.\\s*`,c,`)*`,t.lookahead(/\s*=\s*[^#\s]/)),className:`attr`,starts:{end:/$/,contains:[r,s,a,i,o,n]}}]}}var tn=`[0-9](_*[0-9])*`,nn=`\\.(${tn})`,rn=`[0-9a-fA-F](_*[0-9a-fA-F])*`,an={className:`number`,variants:[{begin:`(\\b(${tn})((${nn})|\\.)?|(${nn}))[eE][+-]?(${tn})[fFdD]?\\b`},{begin:`\\b(${tn})((${nn})[fFdD]?\\b|\\.([fFdD]\\b)?)`},{begin:`(${nn})[fFdD]?\\b`},{begin:`\\b(${tn})[fFdD]\\b`},{begin:`\\b0[xX]((${rn})\\.?|(${rn})?\\.(${rn}))[pP][+-]?(${tn})[fFdD]?\\b`},{begin:`\\b(0|[1-9](_*[0-9])*)[lL]?\\b`},{begin:`\\b0[xX](${rn})[lL]?\\b`},{begin:`\\b0(_*[0-7])*[lL]?\\b`},{begin:`\\b0[bB][01](_*[01])*[lL]?\\b`}],relevance:0};function on(e,t,n){return n===-1?``:e.replace(t,r=>on(e,t,n-1))}function sn(e){let t=e.regex,n=`[À-ʸa-zA-Z_$][À-ʸa-zA-Z_$0-9]*`,r=`(?:(?:\\s*\\[\\s*])+)?`,i=`(?:\\?(?:\\s+(?:extends|super)\\s+[À-ʸa-zA-Z_$][À-ʸa-zA-Z_$0-9]*<@@@>(?:(?:\\s*\\[\\s*])+)?)?|[À-ʸa-zA-Z_$][À-ʸa-zA-Z_$0-9]*<@@@>(?:(?:\\s*\\[\\s*])+)?)`,a=on(`(?:\\s*<\\s*`+i+`(?:\\s*,\\s*`+i+`)*\\s*>)?`,/<@@@>/g,2),o={keyword:`synchronized.abstract.private.var.static.if.const .for.while.strictfp.finally.protected.import.native.final.void.enum.else.break.transient.catch.instanceof.volatile.case.assert.package.default.public.try.switch.continue.throws.protected.public.private.module.requires.exports.do.sealed.yield.permits.goto.when`.split(`.`),literal:[`false`,`true`,`null`],type:[`char`,`boolean`,`long`,`float`,`int`,`byte`,`short`,`double`],built_in:[`super`,`this`]},s={className:`meta`,begin:`@`+n,contains:[{begin:/\(/,end:/\)/,contains:[`self`]}]},c={className:`params`,begin:/\(/,end:/\)/,keywords:o,relevance:0,contains:[e.C_BLOCK_COMMENT_MODE],endsParent:!0};return{name:`Java`,aliases:[`jsp`],keywords:o,illegal:/<\/|#/,contains:[e.COMMENT(`/\\*\\*`,`\\*/`,{relevance:0,contains:[{begin:/\w+@/,relevance:0},{className:`doctag`,begin:`@[A-Za-z]+`}]}),{begin:/import java\.[a-z]+\./,keywords:`import`,relevance:2},e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,{begin:/"""/,end:/"""/,className:`string`,contains:[e.BACKSLASH_ESCAPE]},e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,{match:[/\b(?:class|interface|enum|extends|implements|new)/,/\s+/,n],className:{1:`keyword`,3:`title.class`}},{match:/non-sealed/,scope:`keyword`},{beginKeywords:`new throw return else yield assert`,relevance:0},{begin:[n,t.concat(a,r,/\s+/),n,r,/\s*/,/=(?!=)/],className:{1:`type`,3:`variable`,6:`operator`}},{begin:[/record/,/\s+/,n],className:{1:`keyword`,3:`title.class`},contains:[c,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE]},{begin:[n,t.concat(a,r,/\s+/),n,/\s*(?=\()/],className:{1:`type`,3:`title.function`},keywords:o,contains:[{className:`params`,begin:/\(/,end:/\)/,keywords:o,relevance:0,contains:[s,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,an,e.C_BLOCK_COMMENT_MODE]},e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE]},an,s]}}var cn=`[A-Za-z$_][0-9A-Za-z$_]*`,ln=`as.in.of.if.for.while.finally.var.new.function.do.return.void.else.break.catch.instanceof.with.throw.case.default.try.switch.continue.typeof.delete.let.yield.const.class.debugger.async.await.static.import.from.export.extends.using`.split(`.`),un=[`true`,`false`,`null`,`undefined`,`NaN`,`Infinity`],dn=`Object.Function.Boolean.Symbol.Math.Date.Number.BigInt.String.RegExp.Array.Float32Array.Float64Array.Int8Array.Uint8Array.Uint8ClampedArray.Int16Array.Int32Array.Uint16Array.Uint32Array.BigInt64Array.BigUint64Array.Set.Map.WeakSet.WeakMap.ArrayBuffer.SharedArrayBuffer.Atomics.DataView.JSON.Promise.Generator.GeneratorFunction.AsyncFunction.Reflect.Proxy.Intl.WebAssembly`.split(`.`),fn=[`Error`,`EvalError`,`InternalError`,`RangeError`,`ReferenceError`,`SyntaxError`,`TypeError`,`URIError`],pn=[`setInterval`,`setTimeout`,`clearInterval`,`clearTimeout`,`require`,`exports`,`eval`,`isFinite`,`isNaN`,`parseFloat`,`parseInt`,`decodeURI`,`decodeURIComponent`,`encodeURI`,`encodeURIComponent`,`escape`,`unescape`],mn=[`arguments`,`this`,`super`,`console`,`window`,`document`,`localStorage`,`sessionStorage`,`module`,`self`,`global`],hn=[].concat(pn,dn,fn);function gn(e){let t=e.regex,n=(e,{after:t})=>{let n=`</`+e[0].slice(1);return e.input.indexOf(n,t)!==-1},r=cn,i={begin:`<>`,end:`</>`},a=/<[A-Za-z0-9\\._:-]+\s*\/>/,o={begin:/<[A-Za-z0-9\\._:-]+/,end:/\/[A-Za-z0-9\\._:-]+>|\/>/,isTrulyOpeningTag:(e,t)=>{let r=e[0].length+e.index,i=e.input[r];if(i===`<`||i===`,`){t.ignoreMatch();return}i===`>`&&(n(e,{after:r})||t.ignoreMatch());let a,o=e.input.substring(r);((a=o.match(/^\s*=/))||(a=o.match(/^\s+extends\s+/))&&a.index===0)&&t.ignoreMatch()}},s={$pattern:cn,keyword:ln,literal:un,built_in:hn,"variable.language":mn},c=`[0-9](_?[0-9])*`,l=`\\.(${c})`,u=`0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*`,d={className:`number`,variants:[{begin:`(\\b(${u})((${l})|\\.)?|(${l}))[eE][+-]?(${c})\\b`},{begin:`\\b(${u})\\b((${l})\\b|\\.)?|(${l})\\b`},{begin:`\\b(0|[1-9](_?[0-9])*)n\\b`},{begin:`\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\b`},{begin:`\\b0[bB][0-1](_?[0-1])*n?\\b`},{begin:`\\b0[oO][0-7](_?[0-7])*n?\\b`},{begin:`\\b0[0-7]+n?\\b`}],relevance:0},f={className:`subst`,begin:`\\$\\{`,end:`\\}`,keywords:s,contains:[]},p={begin:".?html`",end:``,starts:{end:"`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,f],subLanguage:`xml`}},m={begin:".?css`",end:``,starts:{end:"`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,f],subLanguage:`css`}},h={begin:".?gql`",end:``,starts:{end:"`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,f],subLanguage:`graphql`}},g={className:`string`,begin:"`",end:"`",contains:[e.BACKSLASH_ESCAPE,f]},_={className:`comment`,variants:[e.COMMENT(/\/\*\*(?!\/)/,`\\*/`,{relevance:0,contains:[{begin:`(?=@[A-Za-z]+)`,relevance:0,contains:[{className:`doctag`,begin:`@[A-Za-z]+`},{className:`type`,begin:`\\{`,end:`\\}`,excludeEnd:!0,excludeBegin:!0,relevance:0},{className:`variable`,begin:r+`(?=\\s*(-)|$)`,endsParent:!0,relevance:0},{begin:/(?=[^\n])\s/,relevance:0}]}]}),e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE]},v=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,p,m,h,g,{match:/\$\d+/},d];f.contains=v.concat({begin:/\{/,end:/\}/,keywords:s,contains:[`self`].concat(v)});let y=[].concat(_,f.contains),b=y.concat([{begin:/(\s*)\(/,end:/\)/,keywords:s,contains:[`self`].concat(y)}]),x={className:`params`,begin:/(\s*)\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:s,contains:b},S={variants:[{match:[/class/,/\s+/,r,/\s+/,/extends/,/\s+/,t.concat(r,`(`,t.concat(/\./,r),`)*`)],scope:{1:`keyword`,3:`title.class`,5:`keyword`,7:`title.class.inherited`}},{match:[/class/,/\s+/,r],scope:{1:`keyword`,3:`title.class`}}]},C={relevance:0,match:t.either(/\bJSON/,/\b[A-Z][a-z]+([A-Z][a-z]*|\d)*/,/\b[A-Z]{2,}([A-Z][a-z]+|\d)+([A-Z][a-z]*)*/,/\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\d)*([A-Z][a-z]*)*/),className:`title.class`,keywords:{_:[...dn,...fn]}},w={label:`use_strict`,className:`meta`,relevance:10,begin:/^\s*['"]use (strict|asm)['"]/},T={variants:[{match:[/function/,/\s+/,r,/(?=\s*\()/]},{match:[/function/,/\s*(?=\()/]}],className:{1:`keyword`,3:`title.function`},label:`func.def`,contains:[x],illegal:/%/},E={relevance:0,match:/\b[A-Z][A-Z_0-9]+\b/,className:`variable.constant`};function D(e){return t.concat(`(?!`,e.join(`|`),`)`)}let O={match:t.concat(/\b/,D([...pn,`super`,`import`,`await`].map(e=>`${e}\\s*\\(`)),r,t.lookahead(/\s*\(/)),className:`title.function`,relevance:0},k={begin:t.concat(/\./,t.lookahead(t.concat(r,/(?![0-9A-Za-z$_(])/))),end:r,excludeBegin:!0,keywords:`prototype`,className:`property`,relevance:0},A={match:[/get|set/,/\s+/,r,/(?=\()/],className:{1:`keyword`,3:`title.function`},contains:[{begin:/\(\)/},x]},j=`(\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)|`+e.UNDERSCORE_IDENT_RE+`)\\s*=>`,M={match:[/const|var|let/,/\s+/,r,/\s*/,/=\s*/,/(async\s*)?/,t.lookahead(j)],keywords:`async`,className:{1:`keyword`,3:`title.function`},contains:[x]};return{name:`JavaScript`,aliases:[`js`,`jsx`,`mjs`,`cjs`],keywords:s,exports:{PARAMS_CONTAINS:b,CLASS_REFERENCE:C},illegal:/#(?![$_A-Za-z])/,contains:[e.SHEBANG({label:`shebang`,binary:`node`,relevance:5}),w,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,p,m,h,g,_,{match:/\$\d+/},d,C,{scope:`attr`,match:r+t.lookahead(`:`),relevance:0},M,{begin:`(`+e.RE_STARTERS_RE+`|\\b(case|return|throw)\\b)\\s*`,keywords:`return throw case`,relevance:0,contains:[_,e.REGEXP_MODE,{className:`function`,begin:j,returnBegin:!0,end:`\\s*=>`,contains:[{className:`params`,variants:[{begin:e.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\(\s*\)/,skip:!0},{begin:/(\s*)\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:s,contains:b}]}]},{begin:/,/,relevance:0},{match:/\s+/,relevance:0},{variants:[{begin:i.begin,end:i.end},{match:a},{begin:o.begin,"on:begin":o.isTrulyOpeningTag,end:o.end}],subLanguage:`xml`,contains:[{begin:o.begin,end:o.end,skip:!0,contains:[`self`]}]}]},T,{beginKeywords:`while if switch catch for`},{begin:`\\b(?!function)`+e.UNDERSCORE_IDENT_RE+`\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)\\s*\\{`,returnBegin:!0,label:`func.def`,contains:[x,e.inherit(e.TITLE_MODE,{begin:r,className:`title.function`})]},{match:/\.\.\./,relevance:0},k,{match:`\\$`+r,relevance:0},{match:[/\bconstructor(?=\s*\()/],className:{1:`title.function`},contains:[x]},O,E,S,A,{match:/\$[(.]/}]}}var _n={scope:`number`,match:`([-+]?)(\\b0[xX][a-fA-F0-9]+|(\\b\\d+(\\.\\d*)?|\\.\\d+)([eE][-+]?\\d+)?)|NaN|[-+]?Infinity`,relevance:0};function vn(e){let t={className:`attr`,begin:/(("(\\.|[^\\"\r\n])*")|('(\\.|[^\\'\r\n])*'))(?=\s*:)/,relevance:1.01},n={match:/[{}[\],:]/,className:`punctuation`,relevance:0},r=[`true`,`false`,`null`],i={scope:`literal`,beginKeywords:r.join(` `)};return{name:`JSON`,aliases:[`jsonc`,`json5`],keywords:{literal:r},contains:[t,n,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,i,_n,e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE],illegal:`\\S`}}var yn=`[0-9](_*[0-9])*`,bn=`\\.(${yn})`,xn=`[0-9a-fA-F](_*[0-9a-fA-F])*`,Sn={className:`number`,variants:[{begin:`(\\b(${yn})((${bn})|\\.)?|(${bn}))[eE][+-]?(${yn})[fFdD]?\\b`},{begin:`\\b(${yn})((${bn})[fFdD]?\\b|\\.([fFdD]\\b)?)`},{begin:`(${bn})[fFdD]?\\b`},{begin:`\\b(${yn})[fFdD]\\b`},{begin:`\\b0[xX]((${xn})\\.?|(${xn})?\\.(${xn}))[pP][+-]?(${yn})[fFdD]?\\b`},{begin:`\\b(0|[1-9](_*[0-9])*)[lL]?\\b`},{begin:`\\b0[xX](${xn})[lL]?\\b`},{begin:`\\b0(_*[0-7])*[lL]?\\b`},{begin:`\\b0[bB][01](_*[01])*[lL]?\\b`}],relevance:0};function Cn(e){let t={keyword:`abstract as val var vararg get set class object open private protected public noinline crossinline dynamic final enum if else do while for when throw try catch finally import package is in fun override companion reified inline lateinit init interface annotation data sealed internal infix operator out by constructor super tailrec where const inner suspend typealias external expect actual`,built_in:`Byte Short Char Int Long Boolean Float Double Void Unit Nothing`,literal:`true false null`},n={className:`keyword`,begin:/\b(break|continue|return|this)\b/,starts:{contains:[{className:`symbol`,begin:/@\w+/}]}},r={className:`symbol`,begin:e.UNDERSCORE_IDENT_RE+`@`},i={className:`subst`,begin:/\$\{/,end:/\}/,contains:[e.C_NUMBER_MODE]},a={className:`variable`,begin:`\\$`+e.UNDERSCORE_IDENT_RE},o={className:`string`,variants:[{begin:`"""`,end:`"""(?=[^"])`,contains:[a,i]},{begin:`'`,end:`'`,illegal:/\n/,contains:[e.BACKSLASH_ESCAPE]},{begin:`"`,end:`"`,illegal:/\n/,contains:[e.BACKSLASH_ESCAPE,a,i]}]};i.contains.push(o);let s={className:`meta`,begin:`@(?:file|property|field|get|set|receiver|param|setparam|delegate)\\s*:(?:\\s*`+e.UNDERSCORE_IDENT_RE+`)?`},c={className:`meta`,begin:`@`+e.UNDERSCORE_IDENT_RE,contains:[{begin:/\(/,end:/\)/,contains:[e.inherit(o,{className:`string`}),`self`]}]},l=Sn,u=e.COMMENT(`/\\*`,`\\*/`,{contains:[e.C_BLOCK_COMMENT_MODE]}),d={variants:[{className:`type`,begin:e.UNDERSCORE_IDENT_RE},{begin:/\(/,end:/\)/,contains:[]}]},f=d;return f.variants[1].contains=[d],d.variants[1].contains=[f],{name:`Kotlin`,aliases:[`kt`,`kts`,`ktm`,`ktx`],keywords:t,contains:[e.COMMENT(`/\\*\\*`,`\\*/`,{relevance:0,contains:[{className:`doctag`,begin:`@[A-Za-z]+`}]}),e.C_LINE_COMMENT_MODE,u,n,r,s,c,{className:`function`,beginKeywords:`fun`,end:`[(]|$`,returnBegin:!0,excludeEnd:!0,keywords:t,relevance:5,contains:[{begin:e.UNDERSCORE_IDENT_RE+`\\s*\\(`,returnBegin:!0,relevance:0,contains:[e.UNDERSCORE_TITLE_MODE]},{className:`type`,begin:/</,end:/>/,keywords:`reified`,relevance:0},{className:`params`,begin:/\(/,end:/\)/,endsParent:!0,keywords:t,relevance:0,contains:[{begin:/:/,end:/[=,\/]/,endsWithParent:!0,contains:[d,e.C_LINE_COMMENT_MODE,u],relevance:0},e.C_LINE_COMMENT_MODE,u,s,c,o,e.C_NUMBER_MODE]},u]},{begin:[/class|interface|trait/,/\s+/,e.UNDERSCORE_IDENT_RE],beginScope:{3:`title.class`},keywords:`class interface trait`,end:/[:\{(]|$/,excludeEnd:!0,illegal:`extends implements`,contains:[{beginKeywords:`public protected internal private constructor`},e.UNDERSCORE_TITLE_MODE,{className:`type`,begin:/</,end:/>/,excludeBegin:!0,excludeEnd:!0,relevance:0},{className:`type`,begin:/[,:]\s*/,end:/[<\(,){\s]|$/,excludeBegin:!0,returnEnd:!0},s,c]},o,{className:`meta`,begin:`^#!/usr/bin/env`,end:`$`,illegal:`
`},l]}}function wn(e){let t=e.regex,n={begin:/<\/?[A-Za-z_]/,end:`>`,subLanguage:`xml`,relevance:0},r={match:/^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/},i={className:`code`,variants:[{begin:"(`{3,})[^`](.|\\n)*?\\1`*[ ]*"},{begin:`(~{3,})[^~](.|\\n)*?\\1~*[ ]*`},{begin:"```",end:"```+[ ]*$"},{begin:`~~~`,end:`~~~+[ ]*$`},{begin:"`.+?`"},{begin:`(?=^( {4}|\\t))`,contains:[{begin:`^( {4}|\\t)`,end:`(\\n)$`}],relevance:0}]},a={className:`bullet`,begin:`^[ 	]*([*+-]|(\\d+\\.))(?=\\s+)`,end:`\\s+`,excludeEnd:!0},o={begin:/^\[[^\n]+\]:/,returnBegin:!0,contains:[{className:`symbol`,begin:/\[/,end:/\]/,excludeBegin:!0,excludeEnd:!0},{className:`link`,begin:/:\s*/,end:/$/,excludeBegin:!0}]},s={variants:[{begin:/\[.+?\]\[.*?\]/,relevance:0},{begin:/\[.+?\]\(((data|javascript|mailto):|(?:http|ftp)s?:\/\/).*?\)/,relevance:2},{begin:t.concat(/\[.+?\]\(/,/[A-Za-z][A-Za-z0-9+.-]*/,/:\/\/.*?\)/),relevance:2},{begin:/\[.+?\]\([./?&#].*?\)/,relevance:1},{begin:/\[.*?\]\(.*?\)/,relevance:0}],returnBegin:!0,contains:[{match:/\[(?=\])/},{className:`string`,relevance:0,begin:`\\[`,end:`\\]`,excludeBegin:!0,returnEnd:!0},{className:`link`,relevance:0,begin:`\\]\\(`,end:`\\)`,excludeBegin:!0,excludeEnd:!0},{className:`symbol`,relevance:0,begin:`\\]\\[`,end:`\\]`,excludeBegin:!0,excludeEnd:!0}]},c={className:`strong`,contains:[],variants:[{begin:/_{2}(?!\s)/,end:/_{2}/},{begin:/\*{2}(?!\s)/,end:/\*{2}/}]},l={className:`emphasis`,contains:[],variants:[{begin:/\*(?![*\s])/,end:/\*/},{begin:/_(?![_\s])/,end:/_/,relevance:0}]},u=e.inherit(c,{contains:[]}),d=e.inherit(l,{contains:[]});c.contains.push(d),l.contains.push(u);let f=[n,s];return[c,l,u,d].forEach(e=>{e.contains=e.contains.concat(f)}),f=f.concat(c,l),{name:`Markdown`,aliases:[`md`,`mkdown`,`mkd`],contains:[{className:`section`,variants:[{begin:`^#{1,6}`,end:`$`,contains:f},{begin:`(?=^.+?\\n[=-]{2,}$)`,contains:[{begin:`^[=-]*$`},{begin:`^`,end:`\\n`,contains:f}]}]},n,a,r,c,l,{className:`quote`,begin:`^>\\s+`,contains:f,end:`$`},i,s,o,{scope:`literal`,match:/&([a-zA-Z0-9]+|#[0-9]{1,7}|#[Xx][0-9a-fA-F]{1,6});/}]}}function Tn(e){let t=e.regex,n=/(?![A-Za-z0-9])(?![$])/,r=t.concat(/[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*/,n),i=t.concat(/(\\?[A-Z][a-z0-9_\x7f-\xff]+|\\?[A-Z]+(?=[A-Z][a-z0-9_\x7f-\xff])){1,}/,n),a=t.concat(/[A-Z]+/,n),o={scope:`variable`,match:`\\$+`+r},s={scope:`meta`,variants:[{begin:/<\?php/,relevance:10},{begin:/<\?=/},{begin:/<\?/,relevance:.1},{begin:/\?>/}]},c={scope:`subst`,variants:[{begin:/\$\w+/},{begin:/\{\$/,end:/\}/}]},l=e.inherit(e.APOS_STRING_MODE,{illegal:null}),u=e.inherit(e.QUOTE_STRING_MODE,{illegal:null,contains:e.QUOTE_STRING_MODE.contains.concat(c)}),d={begin:/<<<[ \t]*(?:(\w+)|"(\w+)")\n/,end:/[ \t]*(\w+)\b/,contains:e.QUOTE_STRING_MODE.contains.concat(c),"on:begin":(e,t)=>{t.data._beginMatch=e[1]||e[2]},"on:end":(e,t)=>{t.data._beginMatch!==e[1]&&t.ignoreMatch()}},f=e.END_SAME_AS_BEGIN({begin:/<<<[ \t]*'(\w+)'\n/,end:/[ \t]*(\w+)\b/}),p=`[ 	
]`,m={scope:`string`,variants:[u,l,d,f]},h={scope:`number`,variants:[{begin:`\\b0[bB][01]+(?:_[01]+)*\\b`},{begin:`\\b0[oO][0-7]+(?:_[0-7]+)*\\b`},{begin:`\\b0[xX][\\da-fA-F]+(?:_[\\da-fA-F]+)*\\b`},{begin:`(?:\\b\\d+(?:_\\d+)*(\\.(?:\\d+(?:_\\d+)*))?|\\B\\.\\d+)(?:[eE][+-]?\\d+)?`}],relevance:0},g=[`false`,`null`,`true`],_=`__CLASS__.__DIR__.__FILE__.__FUNCTION__.__COMPILER_HALT_OFFSET__.__LINE__.__METHOD__.__NAMESPACE__.__TRAIT__.die.echo.exit.include.include_once.print.require.require_once.array.abstract.and.as.binary.bool.boolean.break.callable.case.catch.class.clone.const.continue.declare.default.do.double.else.elseif.empty.enddeclare.endfor.endforeach.endif.endswitch.endwhile.enum.eval.extends.final.finally.float.for.foreach.from.global.goto.if.implements.instanceof.insteadof.int.integer.interface.isset.iterable.list.match|0.mixed.new.never.object.or.private.protected.public.readonly.real.return.string.switch.throw.trait.try.unset.use.var.void.while.xor.yield`.split(`.`),v=`Error|0.AppendIterator.ArgumentCountError.ArithmeticError.ArrayIterator.ArrayObject.AssertionError.BadFunctionCallException.BadMethodCallException.CachingIterator.CallbackFilterIterator.CompileError.Countable.DirectoryIterator.DivisionByZeroError.DomainException.EmptyIterator.ErrorException.Exception.FilesystemIterator.FilterIterator.GlobIterator.InfiniteIterator.InvalidArgumentException.IteratorIterator.LengthException.LimitIterator.LogicException.MultipleIterator.NoRewindIterator.OutOfBoundsException.OutOfRangeException.OuterIterator.OverflowException.ParentIterator.ParseError.RangeException.RecursiveArrayIterator.RecursiveCachingIterator.RecursiveCallbackFilterIterator.RecursiveDirectoryIterator.RecursiveFilterIterator.RecursiveIterator.RecursiveIteratorIterator.RecursiveRegexIterator.RecursiveTreeIterator.RegexIterator.RuntimeException.SeekableIterator.SplDoublyLinkedList.SplFileInfo.SplFileObject.SplFixedArray.SplHeap.SplMaxHeap.SplMinHeap.SplObjectStorage.SplObserver.SplPriorityQueue.SplQueue.SplStack.SplSubject.SplTempFileObject.TypeError.UnderflowException.UnexpectedValueException.UnhandledMatchError.ArrayAccess.BackedEnum.Closure.Fiber.Generator.Iterator.IteratorAggregate.Serializable.Stringable.Throwable.Traversable.UnitEnum.WeakReference.WeakMap.Directory.__PHP_Incomplete_Class.parent.php_user_filter.self.static.stdClass`.split(`.`),y={keyword:_,literal:(e=>{let t=[];return e.forEach(e=>{t.push(e),e.toLowerCase()===e?t.push(e.toUpperCase()):t.push(e.toLowerCase())}),t})(g),built_in:v},b=e=>e.map(e=>e.replace(/\|\d+$/,``)),x={variants:[{match:[/new/,t.concat(p,`+`),t.concat(`(?!`,b(v).join(`\\b|`),`\\b)`),i],scope:{1:`keyword`,4:`title.class`}}]},S=t.concat(r,`\\b(?!\\()`),C={variants:[{match:[t.concat(/::/,t.lookahead(/(?!class\b)/)),S],scope:{2:`variable.constant`}},{match:[/::/,/class/],scope:{2:`variable.language`}},{match:[i,t.concat(/::/,t.lookahead(/(?!class\b)/)),S],scope:{1:`title.class`,3:`variable.constant`}},{match:[i,t.concat(`::`,t.lookahead(/(?!class\b)/))],scope:{1:`title.class`}},{match:[i,/::/,/class/],scope:{1:`title.class`,3:`variable.language`}}]},w={scope:`attr`,match:t.concat(r,t.lookahead(`:`),t.lookahead(/(?!::)/))},T={relevance:0,begin:/\(/,end:/\)/,keywords:y,contains:[w,o,C,e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE,e.HASH_COMMENT_MODE,m,h,x]},E={relevance:0,match:[/\b/,t.concat(`(?!fn\\b|function\\b|`,b(_).join(`\\b|`),`|`,b(v).join(`\\b|`),`\\b)`),r,t.concat(p,`*`),t.lookahead(/(?=\()/)],scope:{3:`title.function.invoke`},contains:[T]};T.contains.push(E);let D=[w,C,e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE,e.HASH_COMMENT_MODE,m,h,x],O={begin:t.concat(/#\[\s*\\?/,t.either(i,a)),beginScope:`meta`,end:/]/,endScope:`meta`,keywords:{literal:g,keyword:[`new`,`array`]},contains:[{begin:/\[/,end:/]/,keywords:{literal:g,keyword:[`new`,`array`]},contains:[`self`,...D]},...D,{scope:`meta`,variants:[{match:i},{match:a}]}]};return{case_insensitive:!1,keywords:y,contains:[O,e.HASH_COMMENT_MODE,e.COMMENT(`//`,`$`),e.COMMENT(`/\\*`,`\\*/`,{contains:[{scope:`doctag`,match:`@[A-Za-z]+`}]}),{match:/__halt_compiler\(\);/,keywords:`__halt_compiler`,starts:{scope:`comment`,end:e.MATCH_NOTHING_RE,contains:[{match:/\?>/,scope:`meta`,endsParent:!0}]}},s,{scope:`variable.language`,match:/\$this\b/},o,E,C,{match:[/const/,/\s/,r],scope:{1:`keyword`,3:`variable.constant`}},x,{scope:`function`,relevance:0,beginKeywords:`fn function`,end:/[;{]/,excludeEnd:!0,illegal:`[$%\\[]`,contains:[{beginKeywords:`use`},e.UNDERSCORE_TITLE_MODE,{begin:`=>`,endsParent:!0},{scope:`params`,begin:`\\(`,end:`\\)`,excludeBegin:!0,excludeEnd:!0,keywords:y,contains:[`self`,O,o,C,e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE,e.HASH_COMMENT_MODE,m,h]}]},{scope:`class`,variants:[{beginKeywords:`enum`,illegal:/[($"]/},{beginKeywords:`class interface trait`,illegal:/[:($"]/}],relevance:0,end:/\{/,excludeEnd:!0,contains:[{beginKeywords:`extends implements`},e.UNDERSCORE_TITLE_MODE]},{beginKeywords:`namespace`,relevance:0,end:`;`,illegal:/[.']/,contains:[e.inherit(e.UNDERSCORE_TITLE_MODE,{scope:`title.class`})]},{beginKeywords:`use`,relevance:0,end:`;`,contains:[{match:/\b(as|const|function)\b/,scope:`keyword`},e.UNDERSCORE_TITLE_MODE]},m,h]}}function En(e){let t=e.regex,n=/[\p{XID_Start}_]\p{XID_Continue}*/u,r=`and.as.assert.async.await.break.case.class.continue.def.del.elif.else.except.finally.for.from.global.if.import.in.is.lambda.lazy.match.nonlocal|10.not.or.pass.raise.return.try.while.with.yield`.split(`.`),i={$pattern:/[A-Za-z]\w+|__\w+__/,keyword:r,built_in:`__import__.abs.aiter.all.anext.any.ascii.bin.bool.breakpoint.bytearray.bytes.callable.chr.classmethod.compile.complex.delattr.dict.dir.divmod.enumerate.eval.exec.filter.float.format.frozendict.frozenset.getattr.globals.hasattr.hash.help.hex.id.input.int.isinstance.issubclass.iter.len.list.locals.map.max.memoryview.min.next.object.oct.open.ord.pow.print.property.range.repr.reversed.round.sentinel.set.setattr.slice.sorted.staticmethod.str.sum.super.tuple.type.vars.zip`.split(`.`),literal:[`__debug__`,`Ellipsis`,`False`,`None`,`NotImplemented`,`True`],type:[`Any`,`Callable`,`Coroutine`,`Dict`,`List`,`Literal`,`Generic`,`Optional`,`Sequence`,`Set`,`Tuple`,`Type`,`Union`]},a={className:`meta`,begin:/^(>>>|\.\.\.) /},o={className:`subst`,begin:/\{/,end:/\}/,keywords:i,illegal:/#/},s={begin:/\{\{/,relevance:0},c={className:`string`,contains:[e.BACKSLASH_ESCAPE],variants:[{begin:/([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?'''/,end:/'''/,contains:[e.BACKSLASH_ESCAPE,a],relevance:10},{begin:/([uU]|[bB]|[rR]|[bB][rR]|[rR][bB])?"""/,end:/"""/,contains:[e.BACKSLASH_ESCAPE,a],relevance:10},{begin:/([fFtT][rR]|[rR][fFtT]|[fFtT])'''/,end:/'''/,contains:[e.BACKSLASH_ESCAPE,a,s,o]},{begin:/([fFtT][rR]|[rR][fFtT]|[fFtT])"""/,end:/"""/,contains:[e.BACKSLASH_ESCAPE,a,s,o]},{begin:/([uU]|[rR])'/,end:/'/,relevance:10},{begin:/([uU]|[rR])"/,end:/"/,relevance:10},{begin:/([bB]|[bB][rR]|[rR][bB])'/,end:/'/},{begin:/([bB]|[bB][rR]|[rR][bB])"/,end:/"/},{begin:/([fFtT][rR]|[rR][fFtT]|[fFtT])'/,end:/'/,contains:[e.BACKSLASH_ESCAPE,s,o]},{begin:/([fFtT][rR]|[rR][fFtT]|[fFtT])"/,end:/"/,contains:[e.BACKSLASH_ESCAPE,s,o]},e.APOS_STRING_MODE,e.QUOTE_STRING_MODE]},l=`[0-9](_?[0-9])*`,u=`(\\b(${l}))?\\.(${l})|\\b(${l})\\.`,d=`\\b|${r.join(`|`)}`,f={className:`number`,relevance:0,variants:[{begin:`(\\b(${l})|(${u}))[eE][+-]?(${l})[jJ]?(?=${d})`},{begin:`(${u})[jJ]?`},{begin:`\\b([1-9](_?[0-9])*|0+(_?0)*)[lLjJ]?(?=${d})`},{begin:`\\b0[bB](_?[01])+[lL]?(?=${d})`},{begin:`\\b0[oO](_?[0-7])+[lL]?(?=${d})`},{begin:`\\b0[xX](_?[0-9a-fA-F])+[lL]?(?=${d})`},{begin:`\\b(${l})[jJ](?=${d})`}]},p={className:`comment`,begin:t.lookahead(/# type:/),end:/$/,keywords:i,contains:[{begin:/# type:/},{begin:/#/,end:/\b\B/,endsWithParent:!0}]},m={className:`params`,variants:[{className:``,begin:/\(\s*\)/,skip:!0},{begin:/\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:i,contains:[`self`,a,f,c,e.HASH_COMMENT_MODE]}]};return o.contains=[c,f,a],{name:`Python`,aliases:[`py`,`gyp`,`ipython`],unicodeRegex:!0,keywords:i,illegal:/(<\/|\?)|=>/,contains:[a,f,{scope:`variable.language`,match:/\bself\b/},{beginKeywords:`if`,relevance:0},{match:/\bor\b/,scope:`keyword`},c,p,e.HASH_COMMENT_MODE,{match:[/\bdef/,/\s+/,n],scope:{1:`keyword`,3:`title.function`},contains:[m]},{variants:[{match:[/\bclass/,/\s+/,n,/\s*/,/\(\s*/,n,/\s*\)/]},{match:[/\bclass/,/\s+/,n]}],scope:{1:`keyword`,3:`title.class`,6:`title.class.inherited`}},{className:`meta`,begin:/^[\t ]*@/,end:/(?=#)|$/,contains:[f,m,c]}]}}function Dn(e){let t=e.regex,n="([a-zA-Z_]\\w*[!?=]?|[-+~]@|<<|>>|=~|===?|<=>|[<>]=?|\\*\\*|[-/+%^&*~`|]|\\[\\]=?)",r=t.either(/\b([A-Z]+[a-z0-9]+)+/,/\b([A-Z]+[a-z0-9]+)+[A-Z]+/),i=t.concat(r,/(::\w+)*/),a={"variable.constant":[`__FILE__`,`__LINE__`,`__ENCODING__`],"variable.language":[`self`,`super`],keyword:`alias.and.begin.BEGIN.break.case.class.defined.do.else.elsif.end.END.ensure.for.if.in.module.next.not.or.redo.require.rescue.retry.return.then.undef.unless.until.when.while.yield.include.extend.prepend.public.private.protected.raise.throw`.split(`.`),built_in:[`proc`,`lambda`,`attr_accessor`,`attr_reader`,`attr_writer`,`define_method`,`private_constant`,`module_function`],literal:[`true`,`false`,`nil`]},o={className:`doctag`,begin:`@[A-Za-z]+`},s={begin:`#<`,end:`>`},c=[e.COMMENT(`#`,`$`,{contains:[o]}),e.COMMENT(`^=begin`,`^=end`,{contains:[o],relevance:10}),e.COMMENT(`^__END__`,e.MATCH_NOTHING_RE)],l={className:`subst`,begin:/#\{/,end:/\}/,keywords:a},u={className:`string`,contains:[e.BACKSLASH_ESCAPE,l],variants:[{begin:/'/,end:/'/},{begin:/"/,end:/"/},{begin:/`/,end:/`/},{begin:/%[qQwWx]?\(/,end:/\)/},{begin:/%[qQwWx]?\[/,end:/\]/},{begin:/%[qQwWx]?\{/,end:/\}/},{begin:/%[qQwWx]?</,end:/>/},{begin:/%[qQwWx]?\//,end:/\//},{begin:/%[qQwWx]?%/,end:/%/},{begin:/%[qQwWx]?-/,end:/-/},{begin:/%[qQwWx]?\|/,end:/\|/},{begin:/\B\?(\\\d{1,3})/},{begin:/\B\?(\\x[A-Fa-f0-9]{1,2})/},{begin:/\B\?(\\u\{?[A-Fa-f0-9]{1,6}\}?)/},{begin:/\B\?(\\M-\\C-|\\M-\\c|\\c\\M-|\\M-|\\C-\\M-)[\x20-\x7e]/},{begin:/\B\?\\(c|C-)[\x20-\x7e]/},{begin:/\B\?\\?\S/},{begin:t.concat(/<<[-~]?'?/,t.lookahead(/(\w+)(?=\W)[^\n]*\n(?:[^\n]*\n)*?\s*\1\b/)),contains:[e.END_SAME_AS_BEGIN({begin:/(\w+)/,end:/(\w+)/,contains:[e.BACKSLASH_ESCAPE,l]})]}]},d=`[0-9](_?[0-9])*`,f={className:`number`,relevance:0,variants:[{begin:`\\b([1-9](_?[0-9])*|0)(\\.(${d}))?([eE][+-]?(${d})|r)?i?\\b`},{begin:`\\b0[dD][0-9](_?[0-9])*r?i?\\b`},{begin:`\\b0[bB][0-1](_?[0-1])*r?i?\\b`},{begin:`\\b0[oO][0-7](_?[0-7])*r?i?\\b`},{begin:`\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*r?i?\\b`},{begin:`\\b0(_?[0-7])+r?i?\\b`}]},p={variants:[{match:/\(\)/},{className:`params`,begin:/\(/,end:/(?=\))/,excludeBegin:!0,endsParent:!0,keywords:a}]},m=[u,{variants:[{match:[/class\s+/,i,/\s+<\s+/,i]},{match:[/\b(class|module)\s+/,i]}],scope:{2:`title.class`,4:`title.class.inherited`},keywords:a},{match:[/(include|extend)\s+/,i],scope:{2:`title.class`},keywords:a},{relevance:0,match:[i,/\.new[. (]/],scope:{1:`title.class`}},{relevance:0,match:/\b[A-Z][A-Z_0-9]+\b/,className:`variable.constant`},{relevance:0,match:r,scope:`title.class`},{match:[/def/,/\s+/,n],scope:{1:`keyword`,3:`title.function`},contains:[p]},{begin:`::`},{className:`symbol`,begin:e.UNDERSCORE_IDENT_RE+`(!|\\?)?:`,relevance:0},{className:`symbol`,begin:`:(?!\\s)`,contains:[u,{begin:n}],relevance:0},f,{className:`variable`,begin:`(\\$\\W)|((\\$|@@?)(\\w+))(?=[^@$?])(?![A-Za-z])(?![@$?'])`},{className:`params`,begin:/\|(?!=)/,end:/\|/,excludeBegin:!0,excludeEnd:!0,relevance:0,keywords:a},{begin:`(`+e.RE_STARTERS_RE+`|unless)\\s*`,keywords:`unless`,contains:[{className:`regexp`,contains:[e.BACKSLASH_ESCAPE,l],illegal:/\n/,variants:[{begin:`/`,end:`/[a-z]*`},{begin:/%r\{/,end:/\}[a-z]*/},{begin:`%r\\(`,end:`\\)[a-z]*`},{begin:`%r!`,end:`![a-z]*`},{begin:`%r\\[`,end:`\\][a-z]*`}]}].concat(s,c),relevance:0}].concat(s,c);l.contains=m,p.contains=m;let h=[{begin:/^\s*=>/,starts:{end:`$`,contains:m}},{className:`meta.prompt`,begin:`^([>?]>|[\\w#]+\\(\\w+\\):\\d+:\\d+[>*]|(\\w+-)?\\d+\\.\\d+\\.\\d+(p\\d+)?[^\\d][^>]+>)(?=[ ])`,starts:{end:`$`,keywords:a,contains:m}}];return c.unshift(s),{name:`Ruby`,aliases:[`rb`,`gemspec`,`podspec`,`thor`,`irb`],keywords:a,illegal:/\/\*/,contains:[e.SHEBANG({binary:`ruby`})].concat(h,c,m)}}function On(e){let t=e.regex,n=/(r#)?/,r=t.concat(n,e.UNDERSCORE_IDENT_RE),i=t.concat(n,e.IDENT_RE),a={scope:`title.function.invoke`,relevance:0,begin:t.concat(/\b/,/(?!(?:let|for|while|if|else|match)\b)/,i,t.lookahead(/\s*\(/))},o=`([ui](8|16|32|64|128|size)|f(16|32|64|128))?`,s=`abstract.as.async.await.become.box.break.const.continue.crate.do.dyn.else.enum.extern.false.final.fn.for.if.impl.in.let.loop.macro.match.mod.move.mut.override.priv.pub.raw.ref.return.self.Self.static.struct.super.trait.true.try.type.typeof.union.unsafe.unsized.use.virtual.where.while.yield`.split(`.`),c=[`true`,`false`,`Some`,`None`,`Ok`,`Err`],l=`drop .Copy.Send.Sized.Sync.Drop.Fn.FnMut.FnOnce.ToOwned.Clone.Debug.PartialEq.PartialOrd.Eq.Ord.AsRef.AsMut.Into.From.Default.Iterator.Extend.IntoIterator.DoubleEndedIterator.ExactSizeIterator.SliceConcatExt.ToString.assert!.assert_eq!.bitflags!.bytes!.cfg!.col!.concat!.concat_idents!.debug_assert!.debug_assert_eq!.env!.eprintln!.panic!.file!.format!.format_args!.include_bytes!.include_str!.line!.local_data_key!.module_path!.option_env!.print!.println!.select!.stringify!.try!.unimplemented!.unreachable!.vec!.write!.writeln!.macro_rules!.assert_ne!.debug_assert_ne!`.split(`.`),u=[`i8`,`i16`,`i32`,`i64`,`i128`,`isize`,`u8`,`u16`,`u32`,`u64`,`u128`,`usize`,`f16`,`f32`,`f64`,`f128`,`str`,`char`,`bool`,`Box`,`Option`,`Result`,`String`,`Vec`];return{name:`Rust`,aliases:[`rs`],keywords:{$pattern:e.IDENT_RE+`!?`,type:u,keyword:s,literal:c,built_in:l},illegal:`</`,contains:[e.C_LINE_COMMENT_MODE,e.COMMENT(`/\\*`,`\\*/`,{contains:[`self`]}),e.inherit(e.QUOTE_STRING_MODE,{begin:/b?"/,illegal:null}),{scope:`symbol`,begin:/'[a-zA-Z_][a-zA-Z0-9_]*(?!')/},{scope:`string`,variants:[{begin:/b?r(#*)"(.|\n)*?"\1(?!#)/},{begin:/b?'/,end:/'/,contains:[{scope:`char.escape`,match:/\\('|"|\\|\w|x\w{2}|u\w{4}|U\w{8})/}]}]},{scope:`number`,variants:[{begin:`\\b0b([01_]+)`+o},{begin:`\\b0o([0-7_]+)`+o},{begin:`\\b0x([A-Fa-f0-9_]+)`+o},{begin:`\\b(\\d[\\d_]*(\\.[0-9_]+)?([eE][+-]?[0-9_]+)?)`+o}],relevance:0},{begin:[/\bsafe/,/\s+/,/extern/],scope:{1:`keyword`,3:`keyword`}},{begin:[/fn/,/\s+/,r],scope:{1:`keyword`,3:`title.function`}},{scope:`meta`,begin:`#!?\\[`,end:`\\]`,contains:[{scope:`string`,begin:/"/,end:/"/,contains:[e.BACKSLASH_ESCAPE]}]},{begin:[/let/,/\s+/,/(?:mut\s+)?/,r],scope:{1:`keyword`,3:`keyword`,4:`variable`}},{begin:[/for/,/\s+/,r,/\s+/,/in/],scope:{1:`keyword`,3:`variable`,5:`keyword`}},{begin:[/type/,/\s+/,r],scope:{1:`keyword`,3:`title.class`}},{begin:[/(?:trait|enum|struct|union|impl|for)/,/\s+/,r],scope:{1:`keyword`,3:`title.class`}},{begin:e.IDENT_RE+`::`,keywords:{keyword:`Self`,built_in:l,type:u}},{scope:`punctuation`,begin:`->`},a]}}var kn=e=>({IMPORTANT:{scope:`meta`,begin:`!important`},BLOCK_COMMENT:e.C_BLOCK_COMMENT_MODE,HEXCOLOR:{scope:`number`,begin:/#(([0-9a-fA-F]{3,4})|(([0-9a-fA-F]{2}){3,4}))\b/},UNICODE_RANGE:{scope:`number`,begin:/\b[Uu]\+[0-9A-Fa-f][0-9A-Fa-f?]{0,5}(-[0-9A-Fa-f][0-9A-Fa-f]{0,5})?/},FUNCTION_DISPATCH:{className:`built_in`,begin:/[\w-]+(?=\()/},ATTRIBUTE_SELECTOR_MODE:{scope:`selector-attr`,begin:/\[/,end:/\]/,illegal:`$`,contains:[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE]},CSS_NUMBER_MODE:{scope:`number`,begin:e.NUMBER_RE+`(%|em|ex|ch|rem|vw|vh|vmin|vmax|cm|mm|in|pt|pc|px|deg|grad|rad|turn|s|ms|Hz|kHz|dpi|dpcm|dppx)?`,relevance:0},CSS_VARIABLE:{className:`attr`,begin:/--[A-Za-z_][A-Za-z0-9_-]*/}}),An=`a.abbr.address.article.aside.audio.b.blockquote.body.button.canvas.caption.cite.code.dd.del.details.dfn.div.dl.dt.em.fieldset.figcaption.figure.footer.form.h1.h2.h3.h4.h5.h6.header.hgroup.html.i.iframe.img.input.ins.kbd.label.legend.li.main.mark.menu.nav.object.ol.optgroup.option.p.picture.q.quote.samp.section.select.source.span.strong.summary.sup.table.tbody.td.textarea.tfoot.th.thead.time.tr.ul.var.video`.split(`.`),jn=`defs.g.marker.mask.pattern.svg.switch.symbol.feBlend.feColorMatrix.feComponentTransfer.feComposite.feConvolveMatrix.feDiffuseLighting.feDisplacementMap.feFlood.feGaussianBlur.feImage.feMerge.feMorphology.feOffset.feSpecularLighting.feTile.feTurbulence.linearGradient.radialGradient.stop.circle.ellipse.image.line.path.polygon.polyline.rect.text.use.textPath.tspan.foreignObject.clipPath`.split(`.`),Mn=[...An,...jn],Nn=`any-hover.any-pointer.aspect-ratio.color.color-gamut.color-index.device-aspect-ratio.device-height.device-width.display-mode.forced-colors.grid.height.hover.inverted-colors.monochrome.orientation.overflow-block.overflow-inline.pointer.prefers-color-scheme.prefers-contrast.prefers-reduced-motion.prefers-reduced-transparency.resolution.scan.scripting.update.width.min-width.max-width.min-height.max-height`.split(`.`).sort().reverse(),Pn=`active.any-link.blank.checked.current.default.defined.dir.disabled.drop.empty.enabled.first.first-child.first-of-type.fullscreen.future.focus.focus-visible.focus-within.has.host.host-context.hover.indeterminate.in-range.invalid.is.lang.last-child.last-of-type.left.link.local-link.not.nth-child.nth-col.nth-last-child.nth-last-col.nth-last-of-type.nth-of-type.only-child.only-of-type.optional.out-of-range.past.placeholder-shown.read-only.read-write.required.right.root.scope.target.target-within.user-invalid.valid.visited.where`.split(`.`).sort().reverse(),Fn=[`after`,`backdrop`,`before`,`cue`,`cue-region`,`first-letter`,`first-line`,`grammar-error`,`marker`,`part`,`placeholder`,`selection`,`slotted`,`spelling-error`].sort().reverse(),In=`accent-color.align-content.align-items.align-self.alignment-baseline.all.anchor-name.animation.animation-composition.animation-delay.animation-direction.animation-duration.animation-fill-mode.animation-iteration-count.animation-name.animation-play-state.animation-range.animation-range-end.animation-range-start.animation-timeline.animation-timing-function.appearance.aspect-ratio.backdrop-filter.backface-visibility.background.background-attachment.background-blend-mode.background-clip.background-color.background-image.background-origin.background-position.background-position-x.background-position-y.background-repeat.background-size.baseline-shift.block-size.border.border-block.border-block-color.border-block-end.border-block-end-color.border-block-end-style.border-block-end-width.border-block-start.border-block-start-color.border-block-start-style.border-block-start-width.border-block-style.border-block-width.border-bottom.border-bottom-color.border-bottom-left-radius.border-bottom-right-radius.border-bottom-style.border-bottom-width.border-collapse.border-color.border-end-end-radius.border-end-start-radius.border-image.border-image-outset.border-image-repeat.border-image-slice.border-image-source.border-image-width.border-inline.border-inline-color.border-inline-end.border-inline-end-color.border-inline-end-style.border-inline-end-width.border-inline-start.border-inline-start-color.border-inline-start-style.border-inline-start-width.border-inline-style.border-inline-width.border-left.border-left-color.border-left-style.border-left-width.border-radius.border-right.border-right-color.border-right-style.border-right-width.border-spacing.border-start-end-radius.border-start-start-radius.border-style.border-top.border-top-color.border-top-left-radius.border-top-right-radius.border-top-style.border-top-width.border-width.bottom.box-align.box-decoration-break.box-direction.box-flex.box-flex-group.box-lines.box-ordinal-group.box-orient.box-pack.box-shadow.box-sizing.break-after.break-before.break-inside.caption-side.caret-color.clear.clip.clip-path.clip-rule.color.color-interpolation.color-interpolation-filters.color-profile.color-rendering.color-scheme.column-count.column-fill.column-gap.column-rule.column-rule-color.column-rule-style.column-rule-width.column-span.column-width.columns.contain.contain-intrinsic-block-size.contain-intrinsic-height.contain-intrinsic-inline-size.contain-intrinsic-size.contain-intrinsic-width.container.container-name.container-type.content.content-visibility.corner-bottom-left-shape.corner-bottom-right-shape.corner-shape.corner-top-left-shape.corner-top-right-shape.counter-increment.counter-reset.counter-set.cue.cue-after.cue-before.cursor.cx.cy.direction.display.dominant-baseline.empty-cells.enable-background.field-sizing.fill.fill-opacity.fill-rule.filter.flex.flex-basis.flex-direction.flex-flow.flex-grow.flex-shrink.flex-wrap.float.flood-color.flood-opacity.flow.font.font-display.font-family.font-feature-settings.font-kerning.font-language-override.font-optical-sizing.font-palette.font-size.font-size-adjust.font-smooth.font-smoothing.font-stretch.font-style.font-synthesis.font-synthesis-position.font-synthesis-small-caps.font-synthesis-style.font-synthesis-weight.font-variant.font-variant-alternates.font-variant-caps.font-variant-east-asian.font-variant-emoji.font-variant-ligatures.font-variant-numeric.font-variant-position.font-variation-settings.font-weight.forced-color-adjust.gap.glyph-orientation-horizontal.glyph-orientation-vertical.grid.grid-area.grid-auto-columns.grid-auto-flow.grid-auto-rows.grid-column.grid-column-end.grid-column-start.grid-gap.grid-row.grid-row-end.grid-row-start.grid-template.grid-template-areas.grid-template-columns.grid-template-rows.hanging-punctuation.height.hyphenate-character.hyphenate-limit-chars.hyphens.icon.image-orientation.image-rendering.image-resolution.ime-mode.initial-letter.initial-letter-align.inline-size.inset.inset-area.inset-block.inset-block-end.inset-block-start.inset-inline.inset-inline-end.inset-inline-start.isolation.justify-content.justify-items.justify-self.kerning.left.letter-spacing.lighting-color.line-break.line-height.line-height-step.list-style.list-style-image.list-style-position.list-style-type.margin.margin-block.margin-block-end.margin-block-start.margin-bottom.margin-inline.margin-inline-end.margin-inline-start.margin-left.margin-right.margin-top.margin-trim.marker.marker-end.marker-mid.marker-start.marks.mask.mask-border.mask-border-mode.mask-border-outset.mask-border-repeat.mask-border-slice.mask-border-source.mask-border-width.mask-clip.mask-composite.mask-image.mask-mode.mask-origin.mask-position.mask-repeat.mask-size.mask-type.masonry-auto-flow.math-depth.math-shift.math-style.max-block-size.max-height.max-inline-size.max-width.min-block-size.min-height.min-inline-size.min-width.mix-blend-mode.nav-down.nav-index.nav-left.nav-right.nav-up.none.normal.object-fit.object-position.offset.offset-anchor.offset-distance.offset-path.offset-position.offset-rotate.opacity.order.orphans.outline.outline-color.outline-offset.outline-style.outline-width.overflow.overflow-anchor.overflow-block.overflow-clip-margin.overflow-inline.overflow-wrap.overflow-x.overflow-y.overlay.overscroll-behavior.overscroll-behavior-block.overscroll-behavior-inline.overscroll-behavior-x.overscroll-behavior-y.padding.padding-block.padding-block-end.padding-block-start.padding-bottom.padding-inline.padding-inline-end.padding-inline-start.padding-left.padding-right.padding-top.page.page-break-after.page-break-before.page-break-inside.paint-order.pause.pause-after.pause-before.perspective.perspective-origin.place-content.place-items.place-self.pointer-events.position.position-anchor.position-visibility.print-color-adjust.quotes.r.resize.rest.rest-after.rest-before.right.rotate.row-gap.ruby-align.ruby-position.scale.scroll-behavior.scroll-margin.scroll-margin-block.scroll-margin-block-end.scroll-margin-block-start.scroll-margin-bottom.scroll-margin-inline.scroll-margin-inline-end.scroll-margin-inline-start.scroll-margin-left.scroll-margin-right.scroll-margin-top.scroll-padding.scroll-padding-block.scroll-padding-block-end.scroll-padding-block-start.scroll-padding-bottom.scroll-padding-inline.scroll-padding-inline-end.scroll-padding-inline-start.scroll-padding-left.scroll-padding-right.scroll-padding-top.scroll-snap-align.scroll-snap-stop.scroll-snap-type.scroll-timeline.scroll-timeline-axis.scroll-timeline-name.scrollbar-color.scrollbar-gutter.scrollbar-width.shape-image-threshold.shape-margin.shape-outside.shape-rendering.speak.speak-as.src.stop-color.stop-opacity.stroke.stroke-dasharray.stroke-dashoffset.stroke-linecap.stroke-linejoin.stroke-miterlimit.stroke-opacity.stroke-width.tab-size.table-layout.text-align.text-align-all.text-align-last.text-anchor.text-combine-upright.text-decoration.text-decoration-color.text-decoration-line.text-decoration-skip.text-decoration-skip-ink.text-decoration-style.text-decoration-thickness.text-emphasis.text-emphasis-color.text-emphasis-position.text-emphasis-style.text-indent.text-justify.text-orientation.text-overflow.text-rendering.text-shadow.text-size-adjust.text-transform.text-underline-offset.text-underline-position.text-wrap.text-wrap-mode.text-wrap-style.timeline-scope.top.touch-action.transform.transform-box.transform-origin.transform-style.transition.transition-behavior.transition-delay.transition-duration.transition-property.transition-timing-function.translate.unicode-bidi.unicode-range.user-modify.user-select.vector-effect.vertical-align.view-timeline.view-timeline-axis.view-timeline-inset.view-timeline-name.view-transition-name.visibility.voice-balance.voice-duration.voice-family.voice-pitch.voice-range.voice-rate.voice-stress.voice-volume.white-space.white-space-collapse.widows.width.will-change.word-break.word-spacing.word-wrap.writing-mode.x.y.z-index.zoom`.split(`.`).sort().reverse();function Ln(e){let t=kn(e),n=Fn,r=Pn,i=`@[a-z-]+`,a={className:`variable`,begin:`(\\$[a-zA-Z-][a-zA-Z0-9_-]*)\\b`,relevance:0};return{name:`SCSS`,case_insensitive:!0,illegal:`[=/|']`,contains:[e.C_LINE_COMMENT_MODE,e.C_BLOCK_COMMENT_MODE,t.CSS_NUMBER_MODE,{className:`selector-id`,begin:`#[A-Za-z0-9_-]+`,relevance:0},{className:`selector-class`,begin:`\\.[A-Za-z0-9_-]+`,relevance:0},t.ATTRIBUTE_SELECTOR_MODE,{className:`selector-tag`,begin:`\\b(`+Mn.join(`|`)+`)\\b`,relevance:0},{className:`selector-pseudo`,begin:`:(`+r.join(`|`)+`)`},{className:`selector-pseudo`,begin:`:(:)?(`+n.join(`|`)+`)`},a,{begin:/\(/,end:/\)/,contains:[t.CSS_NUMBER_MODE]},t.CSS_VARIABLE,{className:`attribute`,begin:`\\b(`+In.join(`|`)+`)\\b`},{begin:`\\b(whitespace|wait|w-resize|visible|vertical-text|vertical-ideographic|uppercase|upper-roman|upper-alpha|underline|transparent|top|thin|thick|text|text-top|text-bottom|tb-rl|table-header-group|table-footer-group|sw-resize|super|strict|static|square|solid|small-caps|separate|se-resize|scroll|s-resize|rtl|row-resize|ridge|right|repeat|repeat-y|repeat-x|relative|progress|pointer|overline|outside|outset|oblique|nowrap|not-allowed|normal|none|nw-resize|no-repeat|no-drop|newspaper|ne-resize|n-resize|move|middle|medium|ltr|lr-tb|lowercase|lower-roman|lower-alpha|loose|list-item|line|line-through|line-edge|lighter|left|keep-all|justify|italic|inter-word|inter-ideograph|inside|inset|inline|inline-block|inherit|inactive|ideograph-space|ideograph-parenthesis|ideograph-numeric|ideograph-alpha|horizontal|hidden|help|hand|groove|fixed|ellipsis|e-resize|double|dotted|distribute|distribute-space|distribute-letter|distribute-all-lines|disc|disabled|default|decimal|dashed|crosshair|collapse|col-resize|circle|char|center|capitalize|break-word|break-all|bottom|both|bolder|bold|block|bidi-override|below|baseline|auto|always|all-scroll|absolute|table|table-cell)\\b`},{begin:/:/,end:/[;}{]/,relevance:0,contains:[t.BLOCK_COMMENT,a,t.HEXCOLOR,t.CSS_NUMBER_MODE,t.UNICODE_RANGE,e.QUOTE_STRING_MODE,e.APOS_STRING_MODE,t.IMPORTANT,t.FUNCTION_DISPATCH]},{begin:`@(page|font-face)`,keywords:{$pattern:i,keyword:`@page @font-face`}},{begin:`@`,end:`[{;]`,returnBegin:!0,keywords:{$pattern:/[a-z-]+/,keyword:`and or not only`,attribute:Nn.join(` `)},contains:[{begin:i,className:`keyword`},{begin:/[a-z-]+(?=:)/,className:`attribute`},a,e.QUOTE_STRING_MODE,e.APOS_STRING_MODE,t.HEXCOLOR,t.CSS_NUMBER_MODE]},t.FUNCTION_DISPATCH]}}function Rn(e){return{name:`Shell Session`,aliases:[`console`,`shellsession`],contains:[{className:`meta.prompt`,begin:/^\s{0,3}[./~\w\d[\]()@-]*[>%$#][ ]?/,starts:{end:/[^\\](?=\s*$)/,subLanguage:`bash`}}]}}function zn(e){let t=e.regex,n=e.COMMENT(`--`,`$`),r={scope:`string`,variants:[{begin:/'/,end:/'/,contains:[{match:/''/}]}]},i={begin:/"/,end:/"/,contains:[{match:/""/}]},a=[`true`,`false`,`unknown`],o=[`double precision`,`large object`,`with timezone`,`without timezone`],s=`bigint.binary.blob.boolean.char.character.clob.date.dec.decfloat.decimal.float.int.integer.interval.nchar.nclob.national.numeric.real.row.smallint.time.timestamp.varchar.varying.varbinary`.split(`.`),c=[`add`,`asc`,`collation`,`desc`,`final`,`first`,`last`,`view`],l=`abs.acos.all.allocate.alter.and.any.are.array.array_agg.array_max_cardinality.as.asensitive.asin.asymmetric.at.atan.atomic.authorization.avg.begin.begin_frame.begin_partition.between.bigint.binary.blob.boolean.both.by.call.called.cardinality.cascaded.case.cast.ceil.ceiling.char.char_length.character.character_length.check.classifier.clob.close.coalesce.collate.collect.column.commit.condition.connect.constraint.contains.convert.copy.corr.corresponding.cos.cosh.count.covar_pop.covar_samp.create.cross.cube.cume_dist.current.current_catalog.current_date.current_default_transform_group.current_path.current_role.current_row.current_schema.current_time.current_timestamp.current_path.current_role.current_transform_group_for_type.current_user.cursor.cycle.date.day.deallocate.dec.decimal.decfloat.declare.default.define.delete.dense_rank.deref.describe.deterministic.disconnect.distinct.double.drop.dynamic.each.element.else.empty.end.end_frame.end_partition.end-exec.equals.escape.every.except.exec.execute.exists.exp.external.extract.false.fetch.filter.first_value.float.floor.for.foreign.frame_row.free.from.full.function.fusion.get.global.grant.group.grouping.groups.having.hold.hour.identity.in.indicator.initial.inner.inout.insensitive.insert.int.integer.intersect.intersection.interval.into.is.join.json_array.json_arrayagg.json_exists.json_object.json_objectagg.json_query.json_table.json_table_primitive.json_value.lag.language.large.last_value.lateral.lead.leading.left.like.like_regex.listagg.ln.local.localtime.localtimestamp.log.log10.lower.match.match_number.match_recognize.matches.max.member.merge.method.min.minute.mod.modifies.module.month.multiset.national.natural.nchar.nclob.new.no.none.normalize.not.nth_value.ntile.null.nullif.numeric.octet_length.occurrences_regex.of.offset.old.omit.on.one.only.open.or.order.out.outer.over.overlaps.overlay.parameter.partition.pattern.per.percent.percent_rank.percentile_cont.percentile_disc.period.portion.position.position_regex.power.precedes.precision.prepare.primary.procedure.ptf.range.rank.reads.real.recursive.ref.references.referencing.regr_avgx.regr_avgy.regr_count.regr_intercept.regr_r2.regr_slope.regr_sxx.regr_sxy.regr_syy.release.result.return.returns.revoke.right.rollback.rollup.row.row_number.rows.running.savepoint.scope.scroll.search.second.seek.select.sensitive.session_user.set.show.similar.sin.sinh.skip.smallint.some.specific.specifictype.sql.sqlexception.sqlstate.sqlwarning.sqrt.start.static.stddev_pop.stddev_samp.submultiset.subset.substring.substring_regex.succeeds.sum.symmetric.system.system_time.system_user.table.tablesample.tan.tanh.then.time.timestamp.timezone_hour.timezone_minute.to.trailing.translate.translate_regex.translation.treat.trigger.trim.trim_array.true.truncate.uescape.union.unique.unknown.unnest.update.upper.user.using.value.values.value_of.var_pop.var_samp.varbinary.varchar.varying.versioning.when.whenever.where.width_bucket.window.with.within.without.year`.split(`.`),u=`abs.acos.array_agg.asin.atan.avg.cast.ceil.ceiling.coalesce.corr.cos.cosh.count.covar_pop.covar_samp.cume_dist.dense_rank.deref.element.exp.extract.first_value.floor.json_array.json_arrayagg.json_exists.json_object.json_objectagg.json_query.json_table.json_table_primitive.json_value.lag.last_value.lead.listagg.ln.log.log10.lower.max.min.mod.nth_value.ntile.nullif.percent_rank.percentile_cont.percentile_disc.position.position_regex.power.rank.regr_avgx.regr_avgy.regr_count.regr_intercept.regr_r2.regr_slope.regr_sxx.regr_sxy.regr_syy.row_number.sin.sinh.sqrt.stddev_pop.stddev_samp.substring.substring_regex.sum.tan.tanh.translate.translate_regex.treat.trim.trim_array.unnest.upper.value_of.var_pop.var_samp.width_bucket`.split(`.`),d=[`current_catalog`,`current_date`,`current_default_transform_group`,`current_path`,`current_role`,`current_schema`,`current_transform_group_for_type`,`current_user`,`session_user`,`system_time`,`system_user`,`current_time`,`localtime`,`current_timestamp`,`localtimestamp`],f=[`create table`,`insert into`,`primary key`,`foreign key`,`not null`,`alter table`,`add constraint`,`grouping sets`,`on overflow`,`character set`,`respect nulls`,`ignore nulls`,`nulls first`,`nulls last`,`depth first`,`breadth first`],p=u,m=[...l,...c].filter(e=>!u.includes(e)),h={scope:`variable`,match:/@[a-z0-9][a-z0-9_]*/},g={scope:`operator`,match:/[-+*/=%^~]|&&?|\|\|?|!=?|<(?:=>?|<|>)?|>[>=]?/,relevance:0},_={match:t.concat(/\b/,t.either(...p),/\s*\(/),relevance:0,keywords:{built_in:p}};function v(e){return t.concat(/\b/,t.either(...e.map(e=>e.replace(/\s+/,`\\s+`))),/\b/)}let y={scope:`keyword`,match:v(f),relevance:0};function b(e,{exceptions:t,when:n}={}){let r=n;return t||=[],e.map(e=>e.match(/\|\d+$/)||t.includes(e)?e:r(e)?`${e}|0`:e)}return{name:`SQL`,case_insensitive:!0,illegal:/[{}]|<\//,keywords:{$pattern:/\b[\w\.]+/,keyword:b(m,{when:e=>e.length<3}),literal:a,type:s,built_in:d},contains:[{scope:`type`,match:v(o)},y,_,h,r,i,e.C_NUMBER_MODE,e.C_BLOCK_COMMENT_MODE,n,g]}}function Bn(e){return e?typeof e==`string`?e:e.source:null}function Vn(e){return q(`(?=`,e,`)`)}function q(...e){return e.map(e=>Bn(e)).join(``)}function Hn(e){let t=e[e.length-1];return typeof t==`object`&&t.constructor===Object?(e.splice(e.length-1,1),t):{}}function J(...e){return`(`+(Hn(e).capture?``:`?:`)+e.map(e=>Bn(e)).join(`|`)+`)`}new RegExp(J(/\[(?:[^\\\]]|\\.)*\]/,/\(\?<(?![=!])[^>]+>/,/\(\?'[^']+'/,/\(\??/,/\\([1-9][0-9]*)/,/\\./));var Un=e=>q(/\b/,e,/\w$/.test(e)?/\b/:/\B/),Wn=[`Protocol`,`Type`].map(Un),Gn=[`init`,`self`].map(Un),Kn=[`Any`,`Self`],qn=[`actor`,`any`,`associatedtype`,`async`,`await`,/as\?/,/as!/,`as`,`borrowing`,`break`,`case`,`catch`,`class`,`consume`,`consuming`,`continue`,`convenience`,`copy`,`default`,`defer`,`deinit`,`didSet`,`distributed`,`do`,`dynamic`,`each`,`else`,`enum`,`extension`,`fallthrough`,/fileprivate\(set\)/,`fileprivate`,`final`,`for`,`func`,`get`,`guard`,`if`,`import`,`indirect`,`infix`,/init\?/,/init!/,`inout`,/internal\(set\)/,`internal`,`in`,`is`,`isolated`,`nonisolated`,`lazy`,`let`,`macro`,`mutating`,`nonmutating`,/open\(set\)/,`open`,`operator`,`optional`,`override`,`package`,`postfix`,`precedencegroup`,`prefix`,/private\(set\)/,`private`,`protocol`,/public\(set\)/,`public`,`repeat`,`required`,`rethrows`,`return`,`set`,`some`,`static`,`struct`,`subscript`,`super`,`switch`,`throws`,`throw`,/try\?/,/try!/,`try`,`typealias`,/unowned\(safe\)/,/unowned\(unsafe\)/,`unowned`,`var`,`weak`,`where`,`while`,`willSet`],Jn=[`false`,`nil`,`true`],Yn=[`assignment`,`associativity`,`higherThan`,`left`,`lowerThan`,`none`,`right`],Xn=[`#colorLiteral`,`#column`,`#dsohandle`,`#else`,`#elseif`,`#endif`,`#error`,`#file`,`#fileID`,`#fileLiteral`,`#filePath`,`#function`,`#if`,`#imageLiteral`,`#keyPath`,`#line`,`#selector`,`#sourceLocation`,`#warning`],Zn=`abs.all.any.assert.assertionFailure.debugPrint.dump.fatalError.getVaList.isKnownUniquelyReferenced.max.min.numericCast.pointwiseMax.pointwiseMin.precondition.preconditionFailure.print.readLine.repeatElement.sequence.stride.swap.swift_unboxFromSwiftValueWithType.transcode.type.unsafeBitCast.unsafeDowncast.withExtendedLifetime.withUnsafeMutablePointer.withUnsafePointer.withVaList.withoutActuallyEscaping.zip`.split(`.`),Qn=J(/[/=\-+!*%<>&|^~?]/,/[\u00A1-\u00A7]/,/[\u00A9\u00AB]/,/[\u00AC\u00AE]/,/[\u00B0\u00B1]/,/[\u00B6\u00BB\u00BF\u00D7\u00F7]/,/[\u2016-\u2017]/,/[\u2020-\u2027]/,/[\u2030-\u203E]/,/[\u2041-\u2053]/,/[\u2055-\u205E]/,/[\u2190-\u23FF]/,/[\u2500-\u2775]/,/[\u2794-\u2BFF]/,/[\u2E00-\u2E7F]/,/[\u3001-\u3003]/,/[\u3008-\u3020]/,/[\u3030]/),$n=J(Qn,/[\u0300-\u036F]/,/[\u1DC0-\u1DFF]/,/[\u20D0-\u20FF]/,/[\uFE00-\uFE0F]/,/[\uFE20-\uFE2F]/),er=q(Qn,$n,`*`),tr=J(/[a-zA-Z_]/,/[\u00A8\u00AA\u00AD\u00AF\u00B2-\u00B5\u00B7-\u00BA]/,/[\u00BC-\u00BE\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]/,/[\u0100-\u02FF\u0370-\u167F\u1681-\u180D\u180F-\u1DBF]/,/[\u1E00-\u1FFF]/,/[\u200B-\u200D\u202A-\u202E\u203F-\u2040\u2054\u2060-\u206F]/,/[\u2070-\u20CF\u2100-\u218F\u2460-\u24FF\u2776-\u2793]/,/[\u2C00-\u2DFF\u2E80-\u2FFF]/,/[\u3004-\u3007\u3021-\u302F\u3031-\u303F\u3040-\uD7FF]/,/[\uF900-\uFD3D\uFD40-\uFDCF\uFDF0-\uFE1F\uFE30-\uFE44]/,/[\uFE47-\uFEFE\uFF00-\uFFFD]/),nr=J(tr,/\d/,/[\u0300-\u036F\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/),Y=q(tr,nr,`*`),rr=q(/[A-Z]/,nr,`*`),ir=[`attached`,`autoclosure`,q(/convention\(/,J(`swift`,`block`,`c`),/\)/),`discardableResult`,`dynamicCallable`,`dynamicMemberLookup`,`escaping`,`freestanding`,`frozen`,`GKInspectable`,`IBAction`,`IBDesignable`,`IBInspectable`,`IBOutlet`,`IBSegueAction`,`inlinable`,`main`,`nonobjc`,`NSApplicationMain`,`NSCopying`,`NSManaged`,q(/objc\(/,Y,/\)/),`objc`,`objcMembers`,`propertyWrapper`,`requires_stored_property_inits`,`resultBuilder`,`Sendable`,`testable`,`UIApplicationMain`,`unchecked`,`unknown`,`usableFromInline`,`warn_unqualified_access`],ar=[`iOS`,`iOSApplicationExtension`,`macOS`,`macOSApplicationExtension`,`macCatalyst`,`macCatalystApplicationExtension`,`watchOS`,`watchOSApplicationExtension`,`tvOS`,`tvOSApplicationExtension`,`swift`];function or(e){let t={match:/\s+/,relevance:0},n=e.COMMENT(`/\\*`,`\\*/`,{contains:[`self`]}),r=[e.C_LINE_COMMENT_MODE,n],i={match:[/\./,J(...Wn,...Gn)],className:{2:`keyword`}},a={match:q(/\./,J(...qn)),relevance:0},o=qn.filter(e=>typeof e==`string`).concat([`_|0`]),s={variants:[{className:`keyword`,match:J(...qn.filter(e=>typeof e!=`string`).concat(Kn).map(Un),...Gn)}]},c={$pattern:J(/\b\w+/,/#\w+/),keyword:o.concat(Xn),literal:Jn},l=[i,a,s],u=[{match:q(/\./,J(...Zn)),relevance:0},{className:`built_in`,match:q(/\b/,J(...Zn),/(?=\()/)}],d={match:/->/,relevance:0},f=[d,{className:`operator`,relevance:0,variants:[{match:er},{match:`\\.(\\.|${$n})+`}]}],p=`([0-9]_*)+`,m=`([0-9a-fA-F]_*)+`,h={className:`number`,relevance:0,variants:[{match:`\\b(${p})(\\.(${p}))?([eE][+-]?(${p}))?\\b`},{match:`\\b0x(${m})(\\.(${m}))?([pP][+-]?(${p}))?\\b`},{match:/\b0o([0-7]_*)+\b/},{match:/\b0b([01]_*)+\b/}]},g=(e=``)=>({className:`subst`,variants:[{match:q(/\\/,e,/[0\\tnr"']/)},{match:q(/\\/,e,/u\{[0-9a-fA-F]{1,8}\}/)}]}),_=(e=``)=>({className:`subst`,match:q(/\\/,e,/[\t ]*(?:[\r\n]|\r\n)/)}),v=(e=``)=>({className:`subst`,label:`interpol`,begin:q(/\\/,e,/\(/),end:/\)/}),y=(e=``)=>({begin:q(e,/"""/),end:q(/"""/,e),contains:[g(e),_(e),v(e)]}),b=(e=``)=>({begin:q(e,/"/),end:q(/"/,e),contains:[g(e),v(e)]}),x={className:`string`,variants:[y(),y(`#`),y(`##`),y(`###`),b(),b(`#`),b(`##`),b(`###`)]},S=[e.BACKSLASH_ESCAPE,{begin:/\[/,end:/\]/,relevance:0,contains:[e.BACKSLASH_ESCAPE]}],C={begin:/\/[^\s](?=[^/\n]*\/)/,end:/\//,contains:S},w=e=>{let t=q(e,/\//),n=q(/\//,e);return{begin:t,end:n,contains:[...S,{scope:`comment`,begin:`#(?!.*${n})`,end:/$/}]}},T={scope:`regexp`,variants:[w(`###`),w(`##`),w(`#`),C]},E={match:q(/`/,Y,/`/)},D=[E,{className:`variable`,match:/\$\d+/},{className:`variable`,match:`\\$${nr}+`}],O=[{match:/(@|#(un)?)available/,scope:`keyword`,starts:{contains:[{begin:/\(/,end:/\)/,keywords:ar,contains:[...f,h,x]}]}},{scope:`keyword`,match:q(/@/,J(...ir),Vn(J(/\(/,/\s+/)))},{scope:`meta`,match:q(/@/,Y)}],k={match:Vn(/\b[A-Z]/),relevance:0,contains:[{className:`type`,match:q(/(AV|CA|CF|CG|CI|CL|CM|CN|CT|MK|MP|MTK|MTL|NS|SCN|SK|UI|WK|XC)/,nr,`+`)},{className:`type`,match:rr,relevance:0},{match:/[?!]+/,relevance:0},{match:/\.\.\./,relevance:0},{match:q(/\s+&\s+/,Vn(rr)),relevance:0}]},A={begin:/</,end:/>/,keywords:c,contains:[...r,...l,...O,d,k]};k.contains.push(A);let j={begin:/\(/,end:/\)/,relevance:0,keywords:c,contains:[`self`,{match:q(Y,/\s*:/),keywords:`_|0`,relevance:0},...r,T,...l,...u,...f,h,x,...D,...O,k]},M={begin:/</,end:/>/,keywords:`repeat each`,contains:[...r,k]},N={begin:/\(/,end:/\)/,keywords:c,contains:[{begin:J(Vn(q(Y,/\s*:/)),Vn(q(Y,/\s+/,Y,/\s*:/))),end:/:/,relevance:0,contains:[{className:`keyword`,match:/\b_\b/},{className:`params`,match:Y}]},...r,...l,...f,h,x,...O,k,j],endsParent:!0,illegal:/["']/},P={match:[/(func|macro)/,/\s+/,J(E.match,Y,er)],className:{1:`keyword`,3:`title.function`},contains:[M,N,t],illegal:[/\[/,/%/]},F={match:[/\b(?:subscript|init[?!]?)/,/\s*(?=[<(])/],className:{1:`keyword`},contains:[M,N,t],illegal:/\[|%/},I={match:[/operator/,/\s+/,er],className:{1:`keyword`,3:`title`}},L={begin:[/precedencegroup/,/\s+/,rr],className:{1:`keyword`,3:`title`},contains:[k],keywords:[...Yn,...Jn],end:/}/},ee={match:[/class\b/,/\s+/,/func\b/,/\s+/,/\b[A-Za-z_][A-Za-z0-9_]*\b/],scope:{1:`keyword`,3:`keyword`,5:`title.function`}},te={match:[/class\b/,/\s+/,/var\b/],scope:{1:`keyword`,3:`keyword`}},ne={begin:[/(struct|protocol|class|extension|enum|actor)/,/\s+/,Y,/\s*/],beginScope:{1:`keyword`,3:`title.class`},keywords:c,contains:[M,...l,{begin:/:/,end:/\{/,keywords:c,contains:[{scope:`title.class.inherited`,match:rr},...l],relevance:0}]};for(let e of x.variants){let t=e.contains.find(e=>e.label===`interpol`);t.keywords=c;let n=[...l,...u,...f,h,x,...D];t.contains=[...n,{begin:/\(/,end:/\)/,contains:[`self`,...n]}]}return{name:`Swift`,keywords:c,contains:[...r,P,F,ee,te,ne,I,L,{beginKeywords:`import`,end:/$/,contains:[...r],relevance:0},T,...l,...u,...f,h,x,...D,...O,k,j]}}var sr=`[A-Za-z$_][0-9A-Za-z$_]*`,cr=`as.in.of.if.for.while.finally.var.new.function.do.return.void.else.break.catch.instanceof.with.throw.case.default.try.switch.continue.typeof.delete.let.yield.const.class.debugger.async.await.static.import.from.export.extends.using`.split(`.`),lr=[`true`,`false`,`null`,`undefined`,`NaN`,`Infinity`],ur=`Object.Function.Boolean.Symbol.Math.Date.Number.BigInt.String.RegExp.Array.Float32Array.Float64Array.Int8Array.Uint8Array.Uint8ClampedArray.Int16Array.Int32Array.Uint16Array.Uint32Array.BigInt64Array.BigUint64Array.Set.Map.WeakSet.WeakMap.ArrayBuffer.SharedArrayBuffer.Atomics.DataView.JSON.Promise.Generator.GeneratorFunction.AsyncFunction.Reflect.Proxy.Intl.WebAssembly`.split(`.`),dr=[`Error`,`EvalError`,`InternalError`,`RangeError`,`ReferenceError`,`SyntaxError`,`TypeError`,`URIError`],fr=[`setInterval`,`setTimeout`,`clearInterval`,`clearTimeout`,`require`,`exports`,`eval`,`isFinite`,`isNaN`,`parseFloat`,`parseInt`,`decodeURI`,`decodeURIComponent`,`encodeURI`,`encodeURIComponent`,`escape`,`unescape`],pr=[`arguments`,`this`,`super`,`console`,`window`,`document`,`localStorage`,`sessionStorage`,`module`,`self`,`global`],mr=[].concat(fr,ur,dr);function hr(e){let t=e.regex,n=(e,{after:t})=>{let n=`</`+e[0].slice(1);return e.input.indexOf(n,t)!==-1},r=sr,i={begin:`<>`,end:`</>`},a=/<[A-Za-z0-9\\._:-]+\s*\/>/,o={begin:/<[A-Za-z0-9\\._:-]+/,end:/\/[A-Za-z0-9\\._:-]+>|\/>/,isTrulyOpeningTag:(e,t)=>{let r=e[0].length+e.index,i=e.input[r];if(i===`<`||i===`,`){t.ignoreMatch();return}i===`>`&&(n(e,{after:r})||t.ignoreMatch());let a,o=e.input.substring(r);((a=o.match(/^\s*=/))||(a=o.match(/^\s+extends\s+/))&&a.index===0)&&t.ignoreMatch()}},s={$pattern:sr,keyword:cr,literal:lr,built_in:mr,"variable.language":pr},c=`[0-9](_?[0-9])*`,l=`\\.(${c})`,u=`0|[1-9](_?[0-9])*|0[0-7]*[89][0-9]*`,d={className:`number`,variants:[{begin:`(\\b(${u})((${l})|\\.)?|(${l}))[eE][+-]?(${c})\\b`},{begin:`\\b(${u})\\b((${l})\\b|\\.)?|(${l})\\b`},{begin:`\\b(0|[1-9](_?[0-9])*)n\\b`},{begin:`\\b0[xX][0-9a-fA-F](_?[0-9a-fA-F])*n?\\b`},{begin:`\\b0[bB][0-1](_?[0-1])*n?\\b`},{begin:`\\b0[oO][0-7](_?[0-7])*n?\\b`},{begin:`\\b0[0-7]+n?\\b`}],relevance:0},f={className:`subst`,begin:`\\$\\{`,end:`\\}`,keywords:s,contains:[]},p={begin:".?html`",end:``,starts:{end:"`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,f],subLanguage:`xml`}},m={begin:".?css`",end:``,starts:{end:"`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,f],subLanguage:`css`}},h={begin:".?gql`",end:``,starts:{end:"`",returnEnd:!1,contains:[e.BACKSLASH_ESCAPE,f],subLanguage:`graphql`}},g={className:`string`,begin:"`",end:"`",contains:[e.BACKSLASH_ESCAPE,f]},_={className:`comment`,variants:[e.COMMENT(/\/\*\*(?!\/)/,`\\*/`,{relevance:0,contains:[{begin:`(?=@[A-Za-z]+)`,relevance:0,contains:[{className:`doctag`,begin:`@[A-Za-z]+`},{className:`type`,begin:`\\{`,end:`\\}`,excludeEnd:!0,excludeBegin:!0,relevance:0},{className:`variable`,begin:r+`(?=\\s*(-)|$)`,endsParent:!0,relevance:0},{begin:/(?=[^\n])\s/,relevance:0}]}]}),e.C_BLOCK_COMMENT_MODE,e.C_LINE_COMMENT_MODE]},v=[e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,p,m,h,g,{match:/\$\d+/},d];f.contains=v.concat({begin:/\{/,end:/\}/,keywords:s,contains:[`self`].concat(v)});let y=[].concat(_,f.contains),b=y.concat([{begin:/(\s*)\(/,end:/\)/,keywords:s,contains:[`self`].concat(y)}]),x={className:`params`,begin:/(\s*)\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:s,contains:b},S={variants:[{match:[/class/,/\s+/,r,/\s+/,/extends/,/\s+/,t.concat(r,`(`,t.concat(/\./,r),`)*`)],scope:{1:`keyword`,3:`title.class`,5:`keyword`,7:`title.class.inherited`}},{match:[/class/,/\s+/,r],scope:{1:`keyword`,3:`title.class`}}]},C={relevance:0,match:t.either(/\bJSON/,/\b[A-Z][a-z]+([A-Z][a-z]*|\d)*/,/\b[A-Z]{2,}([A-Z][a-z]+|\d)+([A-Z][a-z]*)*/,/\b[A-Z]{2,}[a-z]+([A-Z][a-z]+|\d)*([A-Z][a-z]*)*/),className:`title.class`,keywords:{_:[...ur,...dr]}},w={label:`use_strict`,className:`meta`,relevance:10,begin:/^\s*['"]use (strict|asm)['"]/},T={variants:[{match:[/function/,/\s+/,r,/(?=\s*\()/]},{match:[/function/,/\s*(?=\()/]}],className:{1:`keyword`,3:`title.function`},label:`func.def`,contains:[x],illegal:/%/},E={relevance:0,match:/\b[A-Z][A-Z_0-9]+\b/,className:`variable.constant`};function D(e){return t.concat(`(?!`,e.join(`|`),`)`)}let O={match:t.concat(/\b/,D([...fr,`super`,`import`,`await`].map(e=>`${e}\\s*\\(`)),r,t.lookahead(/\s*\(/)),className:`title.function`,relevance:0},k={begin:t.concat(/\./,t.lookahead(t.concat(r,/(?![0-9A-Za-z$_(])/))),end:r,excludeBegin:!0,keywords:`prototype`,className:`property`,relevance:0},A={match:[/get|set/,/\s+/,r,/(?=\()/],className:{1:`keyword`,3:`title.function`},contains:[{begin:/\(\)/},x]},j=`(\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)|`+e.UNDERSCORE_IDENT_RE+`)\\s*=>`,M={match:[/const|var|let/,/\s+/,r,/\s*/,/=\s*/,/(async\s*)?/,t.lookahead(j)],keywords:`async`,className:{1:`keyword`,3:`title.function`},contains:[x]};return{name:`JavaScript`,aliases:[`js`,`jsx`,`mjs`,`cjs`],keywords:s,exports:{PARAMS_CONTAINS:b,CLASS_REFERENCE:C},illegal:/#(?![$_A-Za-z])/,contains:[e.SHEBANG({label:`shebang`,binary:`node`,relevance:5}),w,e.APOS_STRING_MODE,e.QUOTE_STRING_MODE,p,m,h,g,_,{match:/\$\d+/},d,C,{scope:`attr`,match:r+t.lookahead(`:`),relevance:0},M,{begin:`(`+e.RE_STARTERS_RE+`|\\b(case|return|throw)\\b)\\s*`,keywords:`return throw case`,relevance:0,contains:[_,e.REGEXP_MODE,{className:`function`,begin:j,returnBegin:!0,end:`\\s*=>`,contains:[{className:`params`,variants:[{begin:e.UNDERSCORE_IDENT_RE,relevance:0},{className:null,begin:/\(\s*\)/,skip:!0},{begin:/(\s*)\(/,end:/\)/,excludeBegin:!0,excludeEnd:!0,keywords:s,contains:b}]}]},{begin:/,/,relevance:0},{match:/\s+/,relevance:0},{variants:[{begin:i.begin,end:i.end},{match:a},{begin:o.begin,"on:begin":o.isTrulyOpeningTag,end:o.end}],subLanguage:`xml`,contains:[{begin:o.begin,end:o.end,skip:!0,contains:[`self`]}]}]},T,{beginKeywords:`while if switch catch for`},{begin:`\\b(?!function)`+e.UNDERSCORE_IDENT_RE+`\\([^()]*(\\([^()]*(\\([^()]*\\)[^()]*)*\\)[^()]*)*\\)\\s*\\{`,returnBegin:!0,label:`func.def`,contains:[x,e.inherit(e.TITLE_MODE,{begin:r,className:`title.function`})]},{match:/\.\.\./,relevance:0},k,{match:`\\$`+r,relevance:0},{match:[/\bconstructor(?=\s*\()/],className:{1:`title.function`},contains:[x]},O,E,S,A,{match:/\$[(.]/}]}}function gr(e){let t=e.regex,n=hr(e),r=sr,i=[`any`,`void`,`number`,`boolean`,`string`,`object`,`never`,`symbol`,`bigint`,`unknown`],a={begin:[/namespace/,/\s+/,e.IDENT_RE],beginScope:{1:`keyword`,3:`title.class`}},o={beginKeywords:`interface`,end:/\{/,excludeEnd:!0,keywords:{keyword:`interface extends`,built_in:i},contains:[n.exports.CLASS_REFERENCE]},s={className:`meta`,relevance:10,begin:/^\s*['"]use strict['"]/},c={$pattern:sr,keyword:cr.concat([`type`,`interface`,`public`,`private`,`protected`,`implements`,`declare`,`abstract`,`readonly`,`enum`,`override`,`satisfies`]),literal:lr,built_in:mr.concat(i),"variable.language":pr},l={className:`meta`,begin:`@`+r},u=(e,t,n)=>{let r=e.contains.findIndex(e=>e.label===t);if(r===-1)throw Error(`can not find mode to replace`);e.contains.splice(r,1,n)};Object.assign(n.keywords,c),n.exports.PARAMS_CONTAINS.push(l);let d=n.contains.find(e=>e.scope===`attr`),f=Object.assign({},d,{match:t.concat(r,t.lookahead(/\s*\?:/))});n.exports.PARAMS_CONTAINS.push([n.exports.CLASS_REFERENCE,d,f]),n.contains=n.contains.concat([l,a,o,f]),u(n,`shebang`,e.SHEBANG()),u(n,`use_strict`,s);let p=n.contains.find(e=>e.label===`func.def`);return p.relevance=0,Object.assign(n,{name:`TypeScript`,aliases:[`ts`,`tsx`,`mts`,`cts`]}),n}function _r(e){let t=e.regex,n=t.concat(/[\p{L}_]/u,t.optional(/[\p{L}0-9_.-]*:/u),/[\p{L}0-9_.-]*/u),r=/[\p{L}0-9._:-]+/u,i={className:`symbol`,begin:/&[a-z]+;|&#[0-9]+;|&#x[a-f0-9]+;/},a={begin:/\s/,contains:[{className:`keyword`,begin:/#?[a-z_][a-z1-9_-]+/,illegal:/\n/}]},o=e.inherit(a,{begin:/\(/,end:/\)/}),s=e.inherit(e.APOS_STRING_MODE,{className:`string`}),c=e.inherit(e.QUOTE_STRING_MODE,{className:`string`}),l={endsWithParent:!0,illegal:/</,relevance:0,contains:[{className:`attr`,begin:r,relevance:0},{begin:/=\s*/,relevance:0,contains:[{className:`string`,endsParent:!0,variants:[{begin:/"/,end:/"/,contains:[i]},{begin:/'/,end:/'/,contains:[i]},{begin:/[^\s"'=<>`]+/}]}]}]};return{name:`HTML, XML`,aliases:[`html`,`xhtml`,`rss`,`atom`,`xjb`,`xsd`,`xsl`,`plist`,`wsf`,`svg`],case_insensitive:!0,unicodeRegex:!0,contains:[{className:`meta`,begin:/<![a-z]/,end:/>/,relevance:10,contains:[a,c,s,o,{begin:/\[/,end:/\]/,contains:[{className:`meta`,begin:/<![a-z]/,end:/>/,contains:[a,o,c,s]}]}]},e.COMMENT(/<!--/,/-->/,{relevance:10}),{begin:/<!\[CDATA\[/,end:/\]\]>/,relevance:10},i,{className:`meta`,end:/\?>/,variants:[{begin:/<\?xml/,relevance:10,contains:[c]},{begin:/<\?[a-z][a-z0-9]+/}]},{className:`tag`,begin:/<style(?=\s|>)/,end:/>/,keywords:{name:`style`},contains:[l],starts:{end:/<\/style>/,returnEnd:!0,subLanguage:`css`}},{className:`tag`,begin:/<script(?=\s|>)/,end:/>/,keywords:{name:`script`},contains:[l],starts:{end:/<\/script>/,returnEnd:!0,subLanguage:`javascript`}},{className:`tag`,begin:/<>|<\/>/},{className:`tag`,begin:t.concat(/</,t.lookahead(t.concat(n,t.either(/\/>/,/>/,/\s/)))),end:/\/?>/,contains:[{className:`name`,begin:n,relevance:0,starts:l}]},{className:`tag`,begin:t.concat(/<\//,t.lookahead(t.concat(n,/>/))),contains:[{className:`name`,begin:n,relevance:0},{begin:/>/,relevance:0,endsParent:!0}]}]}}function vr(e){let t=`true false yes no null`,n=`[\\w#;/?:@&=+$,.~*'()[\\]]+`,r={className:`attr`,variants:[{begin:/[\w*@][\w*@ :()\./-]*:(?=[ \t]|$)/},{begin:/"[\w*@][\w*@ :()\./-]*":(?=[ \t]|$)/},{begin:/'[\w*@][\w*@ :()\./-]*':(?=[ \t]|$)/}]},i={className:`template-variable`,variants:[{begin:/\{\{/,end:/\}\}/},{begin:/%\{/,end:/\}/}]},a={className:`string`,relevance:0,begin:/'/,end:/'/,contains:[{match:/''/,scope:`char.escape`,relevance:0}]},o={className:`string`,relevance:0,variants:[{begin:/"/,end:/"/},{begin:/\S+/}],contains:[e.BACKSLASH_ESCAPE,i]},s=e.inherit(o,{variants:[{begin:/'/,end:/'/,contains:[{begin:/''/,relevance:0}]},{begin:/"/,end:/"/},{begin:/[^\s,{}[\]]+/}]}),c={className:`number`,begin:`\\b[0-9]{4}(-[0-9][0-9]){0,2}([Tt \\t][0-9][0-9]?(:[0-9][0-9]){2})?(\\.[0-9]*)?([ \\t])*(Z|[-+][0-9][0-9]?(:[0-9][0-9])?)?\\b`},l={end:`,`,endsWithParent:!0,excludeEnd:!0,keywords:t,relevance:0},u={begin:/\{/,end:/\}/,contains:[l],illegal:`\\n`,relevance:0},d={begin:`\\[`,end:`\\]`,contains:[l],illegal:`\\n`,relevance:0},f=[r,{className:`meta`,begin:`^---\\s*$`,relevance:10},{className:`string`,begin:`[\\|>]([1-9]?[+-])?[ ]*\\n( +)[^ ][^\\n]*\\n(\\2[^\\n]+\\n?)*`},{begin:`<%[%=-]?`,end:`[%-]?%>`,subLanguage:`ruby`,excludeBegin:!0,excludeEnd:!0,relevance:0},{className:`type`,begin:`!\\w+!`+n},{className:`type`,begin:`!<`+n+`>`},{className:`type`,begin:`!`+n},{className:`type`,begin:`!!`+n},{className:`meta`,begin:`&`+e.UNDERSCORE_IDENT_RE+`$`},{className:`meta`,begin:`\\*`+e.UNDERSCORE_IDENT_RE+`$`},{className:`bullet`,begin:`-(?=[ ]|$)`,relevance:0},e.HASH_COMMENT_MODE,{beginKeywords:t,keywords:{literal:t}},c,{className:`number`,begin:e.C_NUMBER_RE+`\\b`,relevance:0},u,d,a,o],p=[...f];return p.pop(),p.push(s),l.contains=p,{name:`YAML`,case_insensitive:!0,aliases:[`yml`],contains:f}}var X=Lt.newInstance();for(let[e,t]of Object.entries({bash:Rt,c:zt,cpp:Bt,csharp:Vt,css:Xt,diff:Zt,dockerfile:Qt,go:$t,ini:en,java:sn,javascript:gn,json:vn,kotlin:Cn,markdown:wn,php:Tn,python:En,ruby:Dn,rust:On,scss:Ln,shell:Rn,sql:zn,swift:or,typescript:gr,xml:_r,yaml:vr}))X.registerLanguage(e,t);X.registerAliases([`js`,`jsx`,`mjs`,`cjs`],{languageName:`javascript`}),X.registerAliases([`ts`,`tsx`],{languageName:`typescript`}),X.registerAliases([`sh`,`zsh`],{languageName:`bash`}),X.registerAliases([`html`,`svg`,`vue`],{languageName:`xml`}),X.registerAliases([`yml`],{languageName:`yaml`}),X.registerAliases([`py`],{languageName:`python`}),X.registerAliases([`rs`],{languageName:`rust`}),X.registerAliases([`rb`],{languageName:`ruby`}),X.registerAliases([`md`],{languageName:`markdown`}),X.registerAliases([`c++`,`h`,`hpp`],{languageName:`cpp`}),X.registerAliases([`cs`],{languageName:`csharp`}),X.registerAliases([`kt`],{languageName:`kotlin`}),X.registerAliases([`toml`],{languageName:`ini`});function yr(e){return e.trim().toLowerCase().replace(/<[^>]*>/g,``).replace(/[^\p{L}\p{N}\s_-]/gu,``).replace(/\s+/g,`-`).replace(/^-+|-+$/g,``)||`section`}var Z=e=>e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`),br={light:{fg:`#1f2328`,muted:`#59636e`,bg:`#ffffff`,border:`#d1d9e0`,codeBg:`#f6f8fa`,link:`#0969da`,quote:`#59636e`,keyword:`#cf222e`,string:`#0a3069`,comment:`#6e7781`,number:`#0550ae`,title:`#8250df`,tag:`#116329`,add:`#dafbe1`,del:`#ffebe9`},dark:{fg:`#e6edf3`,muted:`#9198a1`,bg:`#0d1117`,border:`#3d444d`,codeBg:`#151b23`,link:`#4493f8`,quote:`#9198a1`,keyword:`#ff7b72`,string:`#a5d6ff`,comment:`#8b949e`,number:`#79c0ff`,title:`#d2a8ff`,tag:`#7ee787`,add:`#12261e`,del:`#3c1618`}};function xr(e=`light`,t=32,n,r=!1,i=vt,a,o,s={}){let c={...br[e],...a?{link:a}:{}},l=s.theme&&/^[a-z][a-z-]*$/.test(s.theme)?s.theme:void 0,u=s.mode===`compat`||s.mode===`recover`?s.mode:void 0,d=i.headingFont??i.font,f=i.accentHeadings&&a?a:c.fg;return`${o?`@page { ${o.size?`size: ${o.size}; `:``}margin: ${o.margin}; }\n`:r?`@page { margin: ${t}px; }\n`:``}:root { --accent: ${a??c.link}; --surface: ${c.codeBg}; --border: ${c.border}; --muted: ${c.muted}; --text: ${c.fg}; --page: ${c.bg}; }
html, body { margin: 0; padding: 0; background: ${c.bg}; }
body { color: ${c.fg}; font-family: ${i.font}; font-size: ${i.size}px; line-height: ${i.lineHeight};${i.justify?` text-align: justify;`:``} }
.markdown-body { padding: ${r?0:t}px;${n?` max-width: ${n}px; margin: 0 auto;`:``} }
.markdown-body > *:first-child { margin-top: 0; }
.markdown-body > *:last-child { margin-bottom: 0; }
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { margin-top: 24px; margin-bottom: 16px; font-family: ${d}; font-weight: ${i.headingWeight}; line-height: 1.25; text-align: left; color: ${f}; }
.markdown-body h1 { font-size: 2em;${i.h1Rule?` padding-bottom: 0.3em; border-bottom: 1px solid ${c.border};`:``}${i.chapterBreak?` break-before: page;`:``} }
.markdown-body h2 { font-size: 1.5em;${i.h2Rule?` padding-bottom: 0.3em; border-bottom: 1px solid ${c.border};`:``} }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1em; }
.markdown-body h5 { font-size: 0.875em; }
.markdown-body h6 { font-size: 0.85em; color: ${c.muted}; }
.markdown-body p, .markdown-body ul, .markdown-body ol, .markdown-body blockquote, .markdown-body pre, .markdown-body table { margin-top: 0; margin-bottom: 16px; }
.markdown-body ul, .markdown-body ol { padding-left: 2em; }
.markdown-body li + li { margin-top: 0.25em; }
.markdown-body li > ul, .markdown-body li > ol { margin-top: 0.25em; margin-bottom: 0; }
.markdown-body a { color: ${c.link}; text-decoration: none; }
.markdown-body strong { font-weight: 600; }
.markdown-body blockquote { margin-left: 0; margin-right: 0; padding: 0 1em; color: ${c.quote}; border-left: 4px solid ${c.border}; }
.markdown-body blockquote > *:last-child { margin-bottom: 0; }
.markdown-body code { padding: 0.2em 0.4em; font-family: ${i.mono}; font-size: 85%; background: ${c.codeBg}; border-radius: ${i.radius}px; }
.markdown-body pre { padding: 16px; overflow: hidden; white-space: pre-wrap; word-break: break-all; font-size: 85%; line-height: 1.45; background: ${c.codeBg}; border-radius: ${i.radius}px; text-align: left; }
.markdown-body .diagram { margin: 0 0 16px; text-align: center; }
.markdown-body .mermaid { display: inline-block; margin: 0; color: ${c.fg};${l?` --mermaid-theme: ${l};`:` --mermaid-fg: ${c.fg}; --mermaid-bg: ${c.bg}; --mermaid-border: ${c.border}; --mermaid-surface: ${c.codeBg};`}${u?` --mermaid-mode: ${u};`:``}${s.directives?` --mermaid-directives: on;`:``} }
.markdown-body pre code { padding: 0; font-size: 100%; background: transparent; white-space: pre-wrap; word-break: break-all; }
.markdown-body .hnum { margin-right: 0.4em; }
.markdown-body .callout { margin: 0 0 16px; padding: 10px 16px; border-left: 4px solid ${c.link}; background: ${c.codeBg}; break-inside: avoid; }
.markdown-body .callout > *:last-child { margin-bottom: 0; }
.markdown-body .callout-title { margin: 0 0 4px; font-weight: 700; color: ${c.link}; }
.markdown-body .callout-tip { border-left-color: #16a34a; }
.markdown-body .callout-tip .callout-title { color: #16a34a; }
.markdown-body .callout-important { border-left-color: #8b5cf6; }
.markdown-body .callout-important .callout-title { color: #8b5cf6; }
.markdown-body .callout-warning { border-left-color: #d97706; }
.markdown-body .callout-warning .callout-title { color: #d97706; }
.markdown-body .callout-caution { border-left-color: #dc2626; }
.markdown-body .callout-caution .callout-title { color: #dc2626; }
.markdown-body .figure { margin: 0 0 16px; text-align: center; break-inside: avoid; }
.markdown-body .figure img { max-width: 100%; }
.markdown-body figcaption { margin-top: 6px; font-size: 0.9em; color: ${c.muted}; }
.markdown-body .pagebreak { height: 1px; margin: 0; break-after: page; }
.markdown-body .fnref { font-size: 0.75em; line-height: 0; }
.markdown-body .footnotes { margin-top: 32px; padding-top: 8px; border-top: 1px solid ${c.border}; font-size: 0.9em; color: ${c.muted}; }
.markdown-body .footnotes-title { margin: 0 0 4px; font-weight: 600; }
.markdown-body .footnotes ol { margin: 0; }
.markdown-body hr { height: 0; margin: 24px 0; border: 0; border-top: 4px solid ${c.border}; }
.markdown-body img { max-width: 100%; }
.markdown-body table { border-collapse: collapse;${i.wideTables?` width: 100%;`:``} }
.markdown-body th, .markdown-body td { padding: 6px 13px; border: 1px solid ${c.border}; }
.markdown-body th { font-weight: 600;${i.wideTables?` white-space: nowrap;`:``} }
.markdown-body tr:nth-child(2n) { background: ${c.codeBg}; }
.markdown-body input[type="checkbox"] { margin: 0 0.4em 0 -1.4em; }
.hljs-keyword, .hljs-doctag, .hljs-template-tag, .hljs-type, .hljs-meta { color: ${c.keyword}; }
.hljs-string, .hljs-regexp, .hljs-symbol { color: ${c.string}; }
.hljs-comment, .hljs-quote { color: ${c.comment}; }
.hljs-number, .hljs-literal, .hljs-attr, .hljs-attribute, .hljs-variable, .hljs-built_in, .hljs-selector-id, .hljs-selector-class, .hljs-params { color: ${c.number}; }
.hljs-title { color: ${c.title}; }
.hljs-name, .hljs-tag, .hljs-selector-tag, .hljs-bullet { color: ${c.tag}; }
.hljs-section { color: ${c.number}; font-weight: 600; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 600; }
.hljs-addition { color: ${c.tag}; background: ${c.add}; }
.hljs-deletion { color: ${c.keyword}; background: ${c.del}; }
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { break-after: avoid; break-inside: avoid; }
.markdown-body .toc { margin: 0 0 24px; break-after: page; }
.markdown-body .toc-title { margin: 0 0 12px; font-size: 1.5em; font-weight: 600; line-height: 1.25; }
.markdown-body .toc-item { display: flex; align-items: baseline; padding: 2px 0; color: ${c.fg}; text-decoration: none; }
.markdown-body .toc-l1 { font-weight: 600; margin-top: 6px; }
.markdown-body .toc-l2 { padding-left: 1.25em; }
.markdown-body .toc-l3 { padding-left: 2.5em; }
.markdown-body .toc-l4, .markdown-body .toc-l5, .markdown-body .toc-l6 { padding-left: 3.75em; }
.markdown-body .toc-leader { flex: 1; min-width: 12px; margin: 0 6px; border-bottom: 1px dotted ${c.muted}; }
.markdown-body .toc-page { min-width: 2.5em; text-align: right; color: ${c.muted}; }
.markdown-body pre, .markdown-body .diagram,.markdown-body table, .markdown-body blockquote, .markdown-body img, .markdown-body tr { break-inside: avoid; }
`}function Sr(e){let t=[e.logo?`<img class="cover-logo" src="${Z(e.logo)}" alt="">`:``,`<p class="cover-title">${wt(e.title??``)}</p>`,e.subtitle?`<p class="cover-subtitle">${Z(e.subtitle)}</p>`:``,e.author||e.date?`<p class="cover-meta">${e.author?`<span class="cover-author">${Z(e.author)}</span>`:``}${e.date?`<span class="cover-date">${Z(e.date)}</span>`:``}</p>`:``];return`<header class="cover${e.cover_style&&/^(band|plain|center)$/.test(e.cover_style)?` cover-${e.cover_style}`:``}">${t.join(``)}</header>
`}var Cr=`.cover { margin: 40mm 0 0; break-after: page; }
.cover-logo { display: block; max-height: 22mm; max-width: 60mm; margin-bottom: 14mm; }
.cover-title { margin: 0; font-size: 2.6em; font-weight: 700; line-height: 1.25; }
.cover-subtitle { margin: 0.6em 0 0; font-size: 1.25em; color: var(--muted, #6b7280); }
.cover-meta { margin: 3em 0 0; color: var(--muted, #6b7280); }
.cover-meta span + span { margin-left: 1.5em; }
.cover.cover-plain { padding: 0; border: 0; }
.cover.cover-center { padding: 0; border: 0; text-align: center; }
.cover.cover-band { padding-left: 14px; border-left: 6px solid var(--accent, #1d4ed8); text-align: left; }
`;function wr(e,t){let n=Math.min(6,Math.max(1,t.depth??3)),r=t.title??`Contents`,i=e.filter(e=>e.level<=n).map(e=>`<a class="toc-item toc-l${e.level}" href="#${e.id}"><span class="toc-text">${e.html}</span><span class="toc-leader"></span><span class="toc-page" data-toc-page="${e.id}">0</span></a>`).join(``);return i?`<nav class="toc">${r?`<p class="toc-title">${Z(r)}</p>`:``}${i}</nav>
`:``}function Tr(e,t={}){let n=e,r={};if(t.frontMatter!==!1){let e=/^﻿?---[ \t]*\r?\n([^]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(n);e&&(n=n.slice(e[0].length),r=Ct(e[1]))}let i=(typeof t.template==`string`?t.template:void 0)??r.template,a=At(typeof t.template==`object`?t.template:i),o={...a.defaults,...r,...t.settings,...t.title===void 0?{}:{title:t.title},...t.toc===void 0?{}:{toc:t.toc!==!1}};typeof t.template==`object`?delete o.template:i!==void 0&&(o.template=i);let s=new G.Renderer,c=[],l=new Map,u=[0,0,0,0,0,0];s.heading=function({tokens:e,depth:t,text:n}){let r=yr(n),i=l.get(r)??0;l.set(r,i+1);let a=i===0?r:`${r}-${i+1}`,s=this.parser.parseInline(e);if(o.numbering){u[t-1]++;for(let e=t;e<6;e++)u[e]=0;s=`<span class="hnum">${u.slice(0,t).map(e=>e||1).join(`.`)}</span> ${s}`}return c.push({level:t,id:a,html:s}),`<h${t} id="${a}">${s}</h${t}>\n`},s.code=({text:e,lang:n})=>{let r=(n??``).trim().split(/\s+/)[0];if(r===`mermaid`&&t.mermaid!==!1)return`<div class="diagram"><div class="mermaid">${Z(e)}</div></div>\n`;let i=t.highlight!==!1&&r&&X.getLanguage(r)?X.highlight(e,{language:r,ignoreIllegals:!0}).value:Z(e);return`<pre><code${r?` class="language-${Z(r)}"`:``}>${i}\n</code></pre>\n`},s.blockquote=function({tokens:e}){let t=this.parser.parse(e);return Nt(t,o.lang)??`<blockquote>
${t}</blockquote>
`};let d=0,f=s.paragraph.bind(s);s.paragraph=function(e){let t=e.tokens.length===1?e.tokens[0]:void 0;return t?.type===`image`&&t.title?(d++,`<figure class="figure">${this.parser.parseInline(e.tokens).replace(/ title="[^"]*"/,``)}<figcaption>${Pt(d,o.lang)}　${Z(t.title)}</figcaption></figure>
`):f(e)},s.html=({text:e})=>Ft(e)??e;let p=It();n=p.extract(n);let m=new mt(p.extension,t.math?_t(t.math):{}),h=m.parse(n,{async:!1,gfm:!0,renderer:s})+p.list(e=>m.parseInline(e,{async:!1,gfm:!0}),o.lang?.toLowerCase().startsWith(`ja`)?`脚注`:`Notes`,!!t.paged&&o.footnotes===`page`),g=t.toc??(r.toc!==void 0||a.defaults?.toc!==void 0?o.toc:!!t.paged),_={...o.toc_depth?{depth:o.toc_depth}:{},...o.toc_title?{title:o.toc_title}:{}},v=g===!0&&typeof t.toc==`object`?t.toc:g===!0&&Object.keys(_).length?_:g,y=v&&c.length?wr(c,v===!0?{}:v):``,b=o.cover&&o.title?Sr(o):``,x=b+y+h,S={...vt,...a.type,...o.font?{font:o.font}:{}},C={...yt,...a.page,...o.margin?{margin:o.margin}:{},...o.header===void 0?{}:{header:o.header},...o.footer===void 0?{}:{footer:o.footer}},w=t.template!==void 0||r.template!==void 0||[o.header,o.footer,o.margin,o.orientation].some(e=>e!==void 0),T=e=>o.orientation===`landscape`&&!/\blandscape\b/.test(e)?`${e} landscape`:e,E=w&&t.paged!==!1?{size:T(o.page_size??C.size),margin:C.margin}:o.page_size&&t.paged?{size:T(o.page_size),margin:`${t.padding??32}px`}:void 0,D=t.stylesheet??xr(t.theme,t.padding,t.maxWidth,t.paged,S,o.accent,E,{theme:o.mermaid_theme,mode:o.mermaid_mode,directives:o.mermaid_directives}),O=o.title,k=O?`<title>${Z(O)}</title>`:``,A=`<!doctype html><html${o.lang?` lang="${Z(o.lang)}"`:``}${o.dir?` dir="${Z(o.dir)}"`:``}><head><meta charset="utf-8">${k}<style>${D}${Cr}${a.css??``}${t.math?.css??``}${t.css??``}</style></head><body><article class="markdown-body">${x}</article></body></html>`,j=e=>e?Et(e,o):void 0,M=o.stamp?`<span style="float:right">${Z(o.stamp)}</span>`:``,N=w?j(C.header):o.stamp?`<div style="font:11px sans-serif;color:#6b7280;padding-top:8mm;text-align:right">${M.replace(/<[^>]+>/g,``)}</div>`:void 0;return{html:A,settings:o,renderOptions:{...t.paged&&t.theme===`dark`&&t.stylesheet===void 0?{pdfBackground:br.dark.bg}:{},...N?{pdfHeader:N}:{},...w&&C.footer?{pdfFooter:j(C.footer)}:{},...b&&w&&(N||C.footer)?{pdfSkipRunning:1}:{},...o.title?{pdfTitle:o.title.replace(/<br\s*\/?>/gi,` `)}:{},...o.author?{pdfAuthor:o.author}:{}}}}var Q=a(),Er=({url:e,bytes:t,busy:n,error:r,time:i,fileName:a=`document.pdf`})=>(0,Q.jsxs)(`div`,{className:`flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white`,children:[(0,Q.jsxs)(`div`,{className:`flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 text-sm`,children:[(0,Q.jsxs)(`div`,{className:`flex items-center gap-3 text-gray-600`,children:[(0,Q.jsx)(`span`,{className:`font-semibold text-gray-800`,children:`PDF`}),n&&(0,Q.jsxs)(`span`,{className:`flex items-center gap-1.5 text-blue-600`,children:[(0,Q.jsx)(`span`,{className:`inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent`}),`Converting…`]}),!n&&i!==null&&(0,Q.jsxs)(`span`,{children:[Math.round(i),` ms`]}),!n&&t&&(0,Q.jsxs)(`span`,{children:[(t.byteLength/1024).toFixed(1),` KB`]})]}),(0,Q.jsx)(`button`,{type:`button`,onClick:()=>{if(!t)return;let e=new Blob([t.slice()],{type:`application/pdf`}),n=URL.createObjectURL(e),r=document.createElement(`a`);r.href=n,r.download=a,r.click(),setTimeout(()=>URL.revokeObjectURL(n),100)},disabled:!t,className:`cursor-pointer rounded bg-orange-500 px-3 py-1 text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-300`,children:`Download`})]}),r&&(0,Q.jsx)(`pre`,{className:`m-0 whitespace-pre-wrap border-b border-red-200 bg-red-50 p-3 text-xs text-red-700`,children:r}),(0,Q.jsx)(`div`,{className:`min-h-[480px] flex-1 bg-gray-100`,children:e?(0,Q.jsx)(`embed`,{src:e,type:`application/pdf`,className:`h-full min-h-[480px] w-full border-0`}):(0,Q.jsx)(`div`,{className:`flex h-full min-h-[480px] items-center justify-center text-sm text-gray-500`,children:n?`Converting…`:`The PDF appears here.`})})]}),Dr={template:``,theme:`light`,pageSize:``,accent:``,font:``,stamp:``,cover:`auto`,toc:`auto`,tocDepth:3,outline:!0,math:!0,highlight:!0,width:794},Or=[`A3`,`A4`,`A5`,`B4`,`B5`,`Letter`,`Legal`],kr=e=>e===`auto`?void 0:e===`on`;function Ar(e,t){let n={...e.pageSize?{page_size:e.pageSize}:{},...e.accent?{accent:e.accent}:{},...e.font?{font:e.font}:{},...e.stamp?{stamp:e.stamp}:{},...kr(e.cover)===void 0?{}:{cover:kr(e.cover)}},r=kr(e.toc);return{paged:!0,theme:e.theme,...e.template?{template:e.template}:{},...Object.keys(n).length?{settings:n}:{},...r===!1?{toc:!1}:r===!0?{toc:{depth:e.tocDepth}}:{},highlight:e.highlight,...e.math&&t?{math:t}:{}}}var jr=[`template`,`theme`,`pageSize`,`accent`,`font`,`stamp`,`cover`,`toc`,`tocDepth`,`outline`,`math`,`highlight`,`width`];function Mr(e){let t=new URLSearchParams;for(let n of jr)e[n]!==Dr[n]&&t.set(n,String(e[n]));return t}function Nr(e){let t={...Dr},n=t=>e.get(t)??void 0,r=e=>e===`auto`||e===`on`||e===`off`?e:void 0,i=e=>e===`true`||e!==`false`&&void 0,a=(e,t,n)=>{let r=e===void 0?NaN:parseInt(e,10);return Number.isFinite(r)&&r>=t&&r<=n?r:void 0};t.template=n(`template`)??t.template;let o=n(`theme`);return(o===`light`||o===`dark`)&&(t.theme=o),t.pageSize=n(`pageSize`)??t.pageSize,t.accent=n(`accent`)??t.accent,t.font=n(`font`)??t.font,t.stamp=n(`stamp`)??t.stamp,t.cover=r(n(`cover`))??t.cover,t.toc=r(n(`toc`))??t.toc,t.tocDepth=a(n(`tocDepth`),1,6)??t.tocDepth,t.outline=i(n(`outline`))??t.outline,t.math=i(n(`math`))??t.math,t.highlight=i(n(`highlight`))??t.highlight,t.width=a(n(`width`),200,4e3)??t.width,t}var Pr=({text:e,panel:t,math:n,onPick:r})=>{let a=(0,s.useRef)(Ot()).current,[o,c]=(0,s.useState)({}),l=(0,s.useRef)([]);(0,s.useEffect)(()=>{let r=!1,o=setTimeout(async()=>{c({});for(let e of l.current)URL.revokeObjectURL(e);l.current=[];for(let o of a){if(r)return;try{let a=Tr(e,{...Ar(t,n),template:o.name}),s=await i({value:a.html,width:t.width,format:`pdf`,pdfOutline:!1,...a.renderOptions});if(r)return;let u=s.data,d=URL.createObjectURL(new Blob([u.slice()],{type:`application/pdf`}));l.current.push(d),c(e=>({...e,[o.name]:{name:o.name,description:o.description,url:d}}))}catch(e){r||c(t=>({...t,[o.name]:{name:o.name,description:o.description,error:e instanceof Error?e.message:String(e)}}))}}},600);return()=>{r=!0,clearTimeout(o)}},[e,t.theme,t.pageSize,t.accent,t.font,t.stamp,t.cover,t.toc,t.tocDepth,t.math,t.highlight,t.width,n,a]),(0,s.useEffect)(()=>()=>{for(let e of l.current)URL.revokeObjectURL(e)},[]);let u=Object.keys(o).length;return(0,Q.jsxs)(`div`,{className:`flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3`,children:[(0,Q.jsxs)(`p`,{className:`m-0 text-xs text-gray-500`,children:[u,` / `,a.length,` templates drawn from the Markdown on the left (the first page of each). Click a card to use that template.`]}),(0,Q.jsx)(`div`,{className:`grid grid-cols-2 gap-3 xl:grid-cols-3`,children:a.map(e=>{let n=o[e.name],i=t.template===e.name;return(0,Q.jsxs)(`button`,{type:`button`,onClick:()=>r(e.name),className:`flex cursor-pointer flex-col overflow-hidden rounded-lg border text-left transition-shadow hover:shadow-md ${i?`border-blue-600 ring-2 ring-blue-200`:`border-gray-200`}`,children:[(0,Q.jsxs)(`span`,{className:`border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs`,children:[(0,Q.jsx)(`span`,{className:`font-semibold text-gray-800`,children:e.name}),(0,Q.jsx)(`span`,{className:`block truncate text-gray-500`,title:e.description,children:e.description})]}),(0,Q.jsx)(`span`,{className:`relative block h-72 bg-gray-100`,children:n?.url?(0,Q.jsx)(`embed`,{src:`${n.url}#page=1&view=Fit&toolbar=0&navpanes=0&scrollbar=0`,type:`application/pdf`,className:`pointer-events-none h-full w-full border-0`}):(0,Q.jsx)(`span`,{className:`flex h-full items-center justify-center px-2 text-center text-xs text-gray-400`,children:n?.error??`Rendering…`})})]},e.name)})})]})},Fr=`wasm-html-to-image-resource-cache`;function Ir(){let[e,t]=(0,s.useState)({busy:!1,url:null,bytes:null,time:null,error:null,diagnostics:null,logs:[]}),n=(0,s.useRef)(0),a=(0,s.useRef)(null),o=()=>{a.current&&URL.revokeObjectURL(a.current),a.current=null};(0,s.useEffect)(()=>o,[]);let c=(0,s.useCallback)(async e=>{let s=++n.current;t(e=>({...e,busy:!0,error:null,diagnostics:null,logs:[]}));let c=performance.now();try{let l=await i({value:e.html,width:e.width,format:`pdf`,diagnostics:!0,onDiagnostics:e=>{s===n.current&&t(t=>({...t,diagnostics:e}))},logLevel:r.Info,onLog:(e,r)=>{s===n.current&&t(t=>({...t,logs:[...t.logs,{level:e,message:r}]}))},resolveResource:async(e,t)=>{if(s!==n.current)return null;let r=await caches.open(Fr),i=await r.match(e);if(i)return new Uint8Array(await i.arrayBuffer());let a=await t();return a?.length&&await r.put(e,new Response(a)),a},...e.options});if(s!==n.current)return;let u=l.data;o();let d=URL.createObjectURL(new Blob([u.slice()],{type:`application/pdf`}));a.current=d,t(e=>({...e,busy:!1,url:d,bytes:u,time:performance.now()-c}))}catch(e){if(s!==n.current)return;t(t=>({...t,busy:!1,error:e instanceof Error?e.message:String(e)}))}},[]);return{...e,convert:c}}var Lr=[{id:`report`,label:`Report with charts and a long table (Japanese)`,text:`---
title: 第 3 四半期 活動報告<br>2026 年度
subtitle: 製品開発部門
author: 山田 太郎
date: 2026-10-29
template: report
accent: "#1d4ed8"
stamp: 社外秘
---

# はじめに

本書は、2026 年度第 3 四半期の製品開発部門の活動をまとめたものです。数値は速報値で、確定値は経理の締め後に更新されます。

表紙、目次、ヘッダーの題名、フッターの著者名とページ番号（\`n / N\`）は、フロントマターの \`template: report\` だけで付きます。目次の行を押すと、その見出しのページへ移動できます。

## 概要

売上は前期比で **12%** 増加し、利益率も改善しました。主な要因は次の 3 つです。

- 新製品の立ち上がりが想定より早かったこと
- 既存顧客の更新率が **94%** に達したこと
- 開発コストの見直しが進んだこと

## 主要指標

| 指標 | 第 2 四半期 | 第 3 四半期 | 前期比 |
|---|---:|---:|---:|
| 売上（百万円） | 1,070 | 1,200 | +12% |
| 営業利益（百万円） | 240 | 300 | +25% |
| 更新率 | 91% | 94% | +3pt |

> 数値は速報値です。確定値は後日、別紙で共有します。

## 売上の推移

月ごとの売上と営業利益を、棒グラフと折れ線で示します。

\`\`\`mermaid
xychart-beta
  title "月別の売上と営業利益（百万円）"
  x-axis [4月, 5月, 6月, 7月, 8月, 9月]
  y-axis "百万円" 0 --> 500
  bar [320, 340, 360, 380, 400, 420]
  line [70, 75, 80, 95, 100, 105]
\`\`\`

売上の内訳は、製品別に次のとおりです。

\`\`\`mermaid
pie showData title 製品別の売上構成
  "新製品" : 420
  "主力製品" : 610
  "保守・サポート" : 170
\`\`\`

# 開発の進捗

## 新製品

新製品は、ベータ版の公開から 6 週間で、利用組織が 200 を超えました。

\`\`\`ts
// 利用組織数の集計（例）
const total = organizations.filter((o) => o.active).length;
console.log(\`active: \${total}\`);
\`\`\`

### 品質の指標

リリース判定は、次の基準で行いました。

- [x] 重大な不具合が 0 件
- [x] 主要な操作の応答が 200 ms 以内
- [ ] 海外のタイムゾーンでの検証（第 4 四半期に実施）

### 開発の流れ

開発から公開までの流れは、次の図のとおりです。

\`\`\`mermaid
flowchart LR
  A[設計] --> B[実装] --> C{レビュー}
  C -->|差し戻し| B
  C -->|承認| D[ベータ公開] --> E[一般提供]
\`\`\`

## 課題とリスク

| カテゴリ | 内容 | 影響度 | 対応 | 担当者 |
|---|---|:---:|---|---|
| 技術 | 変換が遅い文書がある | 中 | 並列化で短縮 | 開発 A |
| 品質 | 海外の時間帯が未検証 | 中 | 第 4 四半期に実施 | 品質 |
| 体制 | 兼務が多い | 高 | 2 名を採用 | 管理 |
| 契約 | 更新が年末に集中 | 中 | 早めに提案 | 営業 |
| 運用 | 夜間監視が一人に偏る | 低 | 当番表を見直し | 運用 |
| 法務 | 海外向けの規約改訂 | 中 | 法務と調整中 | 法務 |

## 今後の予定

1. 新製品の一般提供を開始する
2. 海外展開の準備を進める
   1. 現地の規約と税制を確認する
   2. 言語と通貨の対応範囲を決める
3. 更新率 **95%** を目標に、サポート体制を見直す

# 付録

## 用語

- **更新率**: 契約満了の組織のうち、継続した組織の割合
- **利用組織**: 直近 30 日に 1 度でも操作のあった組織

詳細な数表と用語集は、別紙を参照してください。関連資料は [はじめに](#はじめに) から辿れます。
`},{id:`proposal`,label:`Proposal with diagrams and a schedule (Japanese)`,text:`---
title: 業務改善のご提案<br>受発注システム刷新
subtitle: 株式会社サンプル 御中
author: 山田 太郎
date: 2026-10-30
template: proposal
accent: "#0f766e"
stamp: 機密
---

# 1. ご提案の概要

現行の受発注業務は、メールと表計算ソフトに分散しています。本提案では、受注から出荷までを 1 つの画面にまとめ、**転記作業をなくす**ことを目指します。

> 本書の金額は税別・概算です。要件確定後に正式なお見積りを提出します。

# 2. 現状と課題

| 課題 | 影響 | 優先度 |
|---|---|:---:|
| 手作業の転記 | 月 40 時間の工数 | 高 |
| 在庫情報の遅れ | 欠品・過剰在庫 | 高 |
| 承認が紙とメール | 処理に平均 3 日 | 中 |

# 3. 提案する業務フロー

受注から出荷までの流れは次のとおりです。

\`\`\`mermaid
graph LR
  A[受注] --> B{在庫あり?}
  B -->|はい| C[出荷指示]
  B -->|いいえ| D[発注]
  D --> C
  C --> E[請求]
\`\`\`

承認は次のやり取りで完結します。

\`\`\`mermaid
sequenceDiagram
  participant S as 営業
  participant M as 承認者
  participant R as システム
  S->>R: 見積を登録
  R->>M: 承認を依頼
  M-->>R: 承認
  R-->>S: 通知
\`\`\`

案件の状態は次のように遷移します。

\`\`\`mermaid
stateDiagram-v2
  [*] --> 下書き
  下書き --> 承認待ち : 申請
  承認待ち --> 確定 : 承認
  承認待ち --> 下書き : 差戻し
  確定 --> [*]
\`\`\`

# 4. 体制とスケジュール

1. 要件定義(1 か月)
2. 開発・テスト(3 か月)
3. 移行・並行稼働(1 か月)

\`\`\`mermaid
gantt
  title 導入スケジュール
  dateFormat YYYY-MM-DD
  section 要件定義
    ヒアリング・要件整理 :a1, 2026-11-02, 30d
  section 開発
    開発・結合テスト     :a2, after a1, 90d
  section 移行
    データ移行・並行稼働 :a3, after a2, 30d
\`\`\`

システムの構成は次のとおりです。

\`\`\`mermaid
architecture-beta
  group cloud(cloud)[クラウド]
  service web(server)[受発注画面] in cloud
  service api(server)[API] in cloud
  service db(database)[データベース] in cloud
  service erp(internet)[基幹システム]

  web:R -- L:api
  api:R -- L:db
  api:B --> T:erp
\`\`\`

# 5. お見積り

| 項目 | 金額(円) |
|---|---:|
| 要件定義 | 1,200,000 |
| 開発・テスト | 4,800,000 |
| 移行支援 | 900,000 |
| **合計** | **6,900,000** |
`},{id:`showcase`,label:`Feature tour (every element)`,text:`---
title: Markdown to PDF 機能ツアー
subtitle: 書ける要素をひと通り並べた見本
author: wasm-html-to-image
date: 2026-10-30
template: default
---

# 機能ツアー

左の Markdown と右の PDF を見比べながら、書ける要素を順に確かめられます。**見出し**、_強調_、~~取り消し~~、\`インラインコード\`、[リンク](https://github.com/SoraKumo001/wasm-html-to-image) は、すべて PDF 内でもそのまま使えます。

## 見出しの階層

### 第 3 階層の見出し

#### 第 4 階層の見出し

見出しの直後で改ページされないよう、自動で調整されます。

## リスト

- 箇条書き
  - 入れ子の箇条書き
    - さらに深い階層
- もう一つの項目

1. 番号付きリスト
2. 2 番目
   1. 入れ子の番号
   2. もう一つ

- [x] 完了したタスク
- [ ] これからのタスク

## 引用と区切り線

> 引用は左に線が付きます。
>
> > 入れ子の引用も書けます。

---

## 表

| 項目 | 左寄せ | 中央 | 右寄せ |
|---|:---|:---:|---:|
| 日本語の見出し | abc | 中央 | 1,200 |
| 長めの内容を入れた行 | 左に寄る | 真ん中 | 34,500 |
| **太字** と \`code\` | ○ | △ | × |

## コード

\`\`\`ts
interface Point {
  x: number;
  y: number;
}

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
\`\`\`

\`\`\`python
def fib(n: int) -> int:
    """n 番目のフィボナッチ数を返す。"""
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
\`\`\`

\`\`\`json
{ "name": "wasm-html-to-image", "formats": ["pdf", "png", "webp"] }
\`\`\`

\`\`\`sql
SELECT customer_id, SUM(amount) AS total
FROM orders
WHERE created_at >= '2026-01-01'
GROUP BY customer_id
ORDER BY total DESC;
\`\`\`

## 数式

インラインでは $e^{i\\pi} + 1 = 0$ のように、ブロックでは次のように書きます。

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

## 図

Mermaid の図は、コードブロックの言語に \`mermaid\` を指定するだけで描かれます。

\`\`\`mermaid
pie showData title 利用している機能
  "表" : 38
  "コード" : 27
  "図" : 20
  "数式" : 15
\`\`\`

\`\`\`mermaid
sequenceDiagram
  participant M as Markdown
  participant E as エンジン
  participant P as PDF
  M->>E: HTML に変換して渡す
  E->>E: 図・数式・コードを描画
  E-->>P: ベクターのまま出力
\`\`\`

## 画像

\`data:\` URL の SVG 画像も、ベクターのまま埋め込まれます。

![インライン SVG](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzNjAiIGhlaWdodD0iMTIwIiB2aWV3Qm94PSIwIDAgMzYwIDEyMCI+PHJlY3Qgd2lkdGg9IjM2MCIgaGVpZ2h0PSIxMjAiIHJ4PSIxMiIgZmlsbD0iI2VmZjZmZiIvPjxnIGZpbGw9IiMxZDRlZDgiPjxyZWN0IHg9IjMwIiB5PSI2MCIgd2lkdGg9IjI4IiBoZWlnaHQ9IjQwIiByeD0iMyIvPjxyZWN0IHg9IjcwIiB5PSI0MCIgd2lkdGg9IjI4IiBoZWlnaHQ9IjYwIiByeD0iMyIvPjxyZWN0IHg9IjExMCIgeT0iMjAiIHdpZHRoPSIyOCIgaGVpZ2h0PSI4MCIgcng9IjMiLz48L2c+PHRleHQgeD0iMTY1IiB5PSI1OCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjIiIGZvbnQtd2VpZ2h0PSI3MDAiIGZpbGw9IiMxZTNhOGEiPklubGluZSBTVkc8L3RleHQ+PHRleHQgeD0iMTY1IiB5PSI4NiIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM0NzU1NjkiPmRhdGE6IFVSTCBpbWFnZTwvdGV4dD48L3N2Zz4=)

## 長い段落と日本語の組版

日本語の文章は、禁則処理に沿って行が折り返されます。句読点や閉じ括弧（このような場合）が行頭に来ることはありません。英単語の \`word-break\` や URL、たとえば https://example.com/a/very/long/path/that/keeps/going/and/going も、はみ出さずに折り返されます。

PDF では、文字は選択でき、検索でき、フォントは必要な字形だけが埋め込まれます。

---

*この文書は、機能の見本として書かれています。*
`},{id:`diagrams`,label:`Mermaid diagrams`,text:`---
title: Mermaid 図の一覧
author: wasm-html-to-image
template: paper
---

# Mermaid 図の一覧

\` \`\`\`mermaid \` のコードブロックは、エンジンがそのままベクターで描画します。PDF にしても文字は選択でき、拡大しても粗くなりません。

## フローチャート

\`\`\`mermaid
graph LR
  A[受注] --> B{在庫あり?}
  B -->|はい| C[出荷指示]
  B -->|いいえ| D[発注]
  D --> C
  C --> E[請求]
\`\`\`

## シーケンス図

\`\`\`mermaid
sequenceDiagram
  autonumber
  participant U as ユーザー
  participant S as サーバー
  U->>+S: ログイン要求
  S-->>-U: トークン
  Note over U,S: 以降はトークンで認証
\`\`\`

## 状態遷移図

\`\`\`mermaid
stateDiagram-v2
  [*] --> 下書き
  下書き --> 承認待ち : 申請
  承認待ち --> 確定 : 承認
  承認待ち --> 下書き : 差戻し
  確定 --> [*]
\`\`\`

## クラス図

\`\`\`mermaid
classDiagram
  class Animal {
    <<abstract>>
    +String name
    +eat() void
  }
  Animal <|-- Dog
  Animal <|-- Cat
  Dog : +bark()
\`\`\`

## ER 図

\`\`\`mermaid
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  CUSTOMER {
    int id PK
    string name
  }
  ORDER {
    int id PK
    int customer_id FK
  }
\`\`\`

## グラフ

\`\`\`mermaid
xychart-beta
  title "月別売上"
  x-axis [1月, 2月, 3月, 4月, 5月, 6月]
  y-axis "百万円" 0 --> 120
  bar [30, 45, 60, 80, 95, 110]
  line [25, 50, 55, 85, 90, 100]
\`\`\`

## ツリーマップとレーダーチャート

\`\`\`mermaid
treemap-beta
  "開発"
    "フロントエンド": 40
    "バックエンド": 55
  "運用"
    "監視": 20
    "保守": 25
\`\`\`

\`\`\`mermaid
radar-beta
  title スキル比較
  axis a["設計"], b["実装"], c["テスト"], d["運用"], e["文書"]
  curve x["Alice"]{4, 5, 3, 2, 4}
  curve y["Bob"]{3, 3, 5, 4, 2}
  max 5
\`\`\`

## アーキテクチャ図

\`\`\`mermaid
architecture-beta
  group api(cloud)[API]
  service db(database)[Database] in api
  service disk(disk)[Storage] in api
  service server(server)[Server] in api
  service gw(internet)[Gateway]

  gw:R --> L:server
  server:R -- L:db
  server:B -- T:disk
\`\`\`

## C4 図

\`\`\`mermaid
C4Context
  title ネットバンキングのシステム構成
  Person(customer, "顧客", "口座を持つ個人")
  Enterprise_Boundary(bank, "銀行") {
    System(banking, "ネットバンキング", "残高照会と振込")
    SystemDb(ledger, "勘定系DB", "口座と取引")
  }
  System_Ext(mail, "メールシステム", "通知メールを送る")
  Rel(customer, banking, "利用する", "HTTPS")
  Rel(banking, ledger, "読み書きする")
  Rel(banking, mail, "通知を依頼する")
\`\`\`

## ベン図・特性要因図・ツリー表示

\`\`\`mermaid
venn-beta
  title チームの重なり
  set A["フロントエンド"]:20
  set B["バックエンド"]:20
  union A,B["フルスタック"]
\`\`\`

\`\`\`mermaid
ishikawa-beta
  納期遅延
    人
      経験不足
      兼務が多い
    手順
      レビュー待ち
      仕様変更
    環境
      ビルドが遅い
\`\`\`

\`\`\`mermaid
treeView-beta
  "src"
    "cpp"
      "mermaid"
    "ts"
  "README.md"
\`\`\`
`},{id:`book`,label:`Book: chapters and page numbers (Japanese)`,text:`---
title: 吾輩は猫である（抄）
subtitle: 夏目漱石
author: 夏目 漱石
template: book
---

# 一

吾輩は猫である。名前はまだ無い。

どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。吾輩はここで始めて人間というものを見た。しかもあとで聞くとそれは書生という人間中で一番獰悪な種族であったそうだ。

## 書生

この書生というのは時々我々を捕えて煮て食うという話である。しかしその当時は何という考もなかったから別段恐しいとも思わなかった。ただ彼の掌に載せられてスーと持ち上げられた時何だかフワフワした感じがあったばかりである。

掌の上で少し落ちついて書生の顔を見たのがいわゆる人間というものの見始であろう。この時妙なものだと思った感じが今でも残っている。第一毛をもって装飾されべきはずの顔がつるつるしてまるで薬缶だ。その後猫にもだいぶ逢ったがこんな片輪には一度も出会わした事がない。のみならず顔の真中があまりに突起している。そうしてその穴の中から時々ぷうぷうと煙を吹く。どうも咽せぽくて実に弱った。これが人間の飲む煙草というものである事はようやくこの頃知った。

## 吾輩の見たもの

この書生の掌の裏でしばらくはよい心持に坐っておったが、しばらくすると非常な速力で運転し始めた。書生が動くのか自分だけが動くのか分らないが無暗に眼が廻る。胸が悪くなる。到底助からないと思っていると、どさりと音がして眼から火が出た。それまでは記憶しているがあとは何の事やらいくら考え出そうとしても分らない。

# 二

吾輩は今日も縁側で日向ぼっこをしている。主人は書斎に籠って何やら書いているが、何を書いているのかは猫の知るところではない。

> 吾輩は猫である。名前はまだ無い。

ここまで読んで、章ごとに新しいページから始まり、各ページの下にページ番号が入ることを確かめてください。

## 主人

吾輩の主人は教師である。学校から帰ると終日書斎に入ったぎりほとんど出て来る事がない。家のものは大変な勉強家だと思っている。当人も勉強家であるかのごとく見せている。しかし実際はうちのものがいうような勤勉家ではない。吾輩は時々忍び足に彼の書斎を覗いて見るが、彼はよく昼寝をしている事がある。時々読みかけてある本の上に涎をたらしている。

## 朝の食卓

主人は胃弱で皮膚の色の淡黄色を帯びた弾力のない不活溌な徴候をあらわしている。それでも大飯を食う。大飯を食った後でタカジヤスターゼを飲む。飲んだ後で書物をひろげる。二三ページ読むと眠くなる。涎を本の上へ垂らす。これが彼の毎夜繰り返す日課である。

# 三

三毛子は隣の二弦琴の師匠のところの猫である。師匠の家の飼猫だけあって、吾輩のような野良上がりとは違い、毛並みも美しく、上品である。

## 隣の猫

吾輩は三毛子の家の裏を通るたびに、そっと声をかけてみる。三毛子は障子の隙間から顔を出して、にゃあと返事をしてくれる。それだけで、一日の気分が良くなるのだから、猫の世界も存外単純なものである。

## 結び

読み終えたら、ページ番号が章をまたいで続いていること、目次の項目から該当ページへ移れることを確かめてください。
`},{id:`technical`,label:`Paper: maths, code and a flowchart`,text:`---
title: 数式とコードの技術メモ
subtitle: 探索アルゴリズムの計算量
author: A. Author
date: 2026-10-30
template: paper
---

# 数式とコードの技術メモ

**概要.** このメモは、数式（\`$...$\` と \`$$...$$\`）、コードのハイライト、表、図を 1 つの文書で試すためのものです。\`paper\` テンプレートは、serif の本文、両端揃え、引き締まった行送りで、論文や技術ノートの体裁にします。金額の $5 や $10 は数式になりません。

# 1. 数式

## 1.1 二次方程式

$ax^2 + bx + c = 0$ の解は、判別式 $D = b^2 - 4ac$ を使って次のように書けます。

$$
x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
$$

## 1.2 積分と総和

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}, \\qquad \\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}
$$

## 1.3 行列と連立方程式

$$
A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}, \\qquad \\det A = ad - bc
$$

$$
\\begin{cases}
x + y = 5 \\\\
2x - y = 1
\\end{cases}
\\quad\\Longrightarrow\\quad (x, y) = (2, 3)
$$

## 1.4 極限と級数

$$
\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n = e, \\qquad e^{i\\theta} = \\cos\\theta + i\\sin\\theta
$$

# 2. 探索アルゴリズム

## 2.1 実装

\`\`\`ts
// 整列済みの配列から値を探す。見つからなければ -1 を返す。
export function binarySearch(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] === target) return mid;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
\`\`\`

\`\`\`bash
npx wasm-html-to-image memo.md -o memo.pdf --template paper
\`\`\`

## 2.2 計算量

| 手法 | 計算量 | 備考 |
|---|---|---|
| 二分探索 | $O(\\log n)$ | 整列済みが前提 |
| 線形探索 | $O(n)$ | 前提なし |
| ハッシュ探索 | $O(1)$（平均） | 追加のメモリが必要 |

要素数 $n = 10^6$ のとき、二分探索の比較は高々 $\\lceil \\log_2 n \\rceil = 20$ 回です。

## 2.3 処理の流れ

\`\`\`mermaid
flowchart LR
  S([開始]) --> C[中央を調べる]
  C --> E{一致?}
  E -->|はい| R([位置を返す])
  E -->|いいえ| H[範囲を半分に]
  H -->|残る| C
  H -->|空| N([-1])
\`\`\`

# 参考文献

1. D. E. Knuth, *The Art of Computer Programming, Vol. 3: Sorting and Searching*, 2nd ed., Addison-Wesley, 1998.
2. T. H. Cormen et al., *Introduction to Algorithms*, 4th ed., MIT Press, 2022.
`},{id:`compact`,label:`Cheat sheet (compact)`,text:`---
title: Git 早見表
template: compact
---

# Git 早見表

\`compact\` テンプレートは、表紙と目次を付けず、小さな文字と狭い余白で 1 ページに詰め込みます。

## 日常の操作

| やりたいこと | コマンド |
|---|---|
| 状態を見る | \`git status -sb\` |
| 変更を確認する | \`git diff\` / \`git diff --staged\` |
| 一部だけステージする | \`git add -p\` |
| コミットする | \`git commit -m "メッセージ"\` |
| 直前のコミットを直す | \`git commit --amend\` |
| 履歴を見る | \`git log --oneline --graph --decorate\` |

## ブランチ

| やりたいこと | コマンド |
|---|---|
| 一覧を見る | \`git branch -vv\` |
| 作って切り替える | \`git switch -c feature/name\` |
| 取り込む | \`git merge --no-ff feature/name\` |
| 付け替える | \`git rebase main\` |
| 削除する | \`git branch -d feature/name\` |

## 取り消し

| 状況 | コマンド |
|---|---|
| ステージを戻す | \`git restore --staged <file>\` |
| 作業ツリーの変更を捨てる | \`git restore <file>\` |
| コミットを打ち消す（履歴は残す） | \`git revert <commit>\` |
| 直前のコミットを取り消す（変更は残す） | \`git reset --soft HEAD~1\` |

> 共有したブランチで \`reset\` や \`rebase\` を使うと、他の人の履歴とずれます。先に相談してください。

## リモート

\`\`\`bash
git fetch --prune
git pull --rebase
git push -u origin feature/name
git push --force-with-lease   # 強制する場合は、これを使う
\`\`\`

## ブランチの流れ

\`\`\`mermaid
gitGraph
  commit id: "初期化"
  branch feature
  checkout feature
  commit id: "機能追加"
  checkout main
  commit id: "修正"
  merge feature
  commit id: "リリース" tag: "v1.0"
\`\`\`
`},{id:`manual`,label:`Manual: numbered chapters and call-outs (Japanese)`,text:`---
title: 画像変換 CLI 利用マニュアル
subtitle: バージョン 2.0
author: 開発チーム
date: 2026-10-30
template: manual
stamp: 社内向け
---

# はじめに

本書は、コマンドラインから Markdown を PDF に変換する手順をまとめたマニュアルです。

> [!NOTE]
> 章は新しいページから始まり、見出しには自動で番号が付きます。目次の行を押すと、その見出しへ移動できます。

## 対象読者

- 文書を PDF にして配布したい方
- CI で PDF を自動生成したい方

## 動作環境

| 項目 | 要件 |
|---|---|
| Node.js | 20 以上 |
| OS | Windows / macOS / Linux |
| 追加のソフト | 不要（WebAssembly に同梱） |

# インストール

## npm から入れる

\`\`\`bash
npm install wasm-html-to-image
\`\`\`

> [!TIP]
> インストールせずに試すだけなら、\`npx wasm-html-to-image\` で実行できます。

## 動作の確認

\`\`\`bash
npx wasm-html-to-image --version
\`\`\`

# 使い方

## 基本

Markdown ファイルを渡すと、拡張子に合わせた形式で出力します。

\`\`\`bash
npx wasm-html-to-image report.md -o report.pdf --template report
\`\`\`

## 主なオプション

| オプション | 既定値 | 内容 |
|---|---|---|
| \`--template\` | \`default\` | テンプレートの名前 |
| \`--accent\` | テンプレート依存 | 見出しや表紙の色 |
| \`--stamp\` | なし | 各ページの上に出す文字列 |

> [!WARNING]
> 出力先に同じ名前のファイルがあると、確認なしで上書きします。

## 変換の流れ

\`\`\`mermaid
flowchart LR
  A[Markdown] --> B[HTML に変換]
  B --> C[ページを割り付け]
  C --> D[PDF を出力]
\`\`\`

# トラブルシューティング

## 日本語が四角で表示される

> [!IMPORTANT]
> 表示できない文字は、字形が見つからないことが原因です。フォントを指定するか、\`font: sans-serif\` を試してください。

## 図が表示されない

図の記法が誤っている場合は、図の位置にエラーの枠が出ます。枠の文言から原因をたどれます。
`},{id:`minutes`,label:`Meeting minutes (Japanese)`,text:`---
title: 第 12 回 定例会議 議事録
author: 記録: 佐藤
date: 2026-10-30
template: minutes
---

# 第 12 回 定例会議 議事録

| 項目 | 内容 |
|---|---|
| 日時 | 2026 年 10 月 30 日（金）10:00〜11:00 |
| 場所 | 第 2 会議室 / オンライン |
| 出席者 | 山田、佐藤、鈴木、田中 |
| 欠席者 | 高橋 |

## 1. 前回の確認

- 前回の宿題はすべて完了した。
- リリース判定の基準を、次回までに文書化する。

## 2. 議題

### 2.1 第 3 四半期の進捗

売上は前期比 **12%** 増。更新率は **94%** に達した。

### 2.2 海外展開

- 現地の規約と税制の確認が必要
- 言語と通貨の対応範囲を決める

> [!NOTE]
> 次回は、法務の担当者にも出席してもらう。

## 3. 決定事項

| 番号 | 内容 | 決定者 |
|:---:|---|---|
| D-1 | 海外展開の準備を、来月から開始する | 山田 |
| D-2 | 更新率の目標を 95% とする | 全員 |

## 4. 宿題（ToDo）

- [ ] リリース判定の基準を文書化する（鈴木・11/6）
- [ ] 海外の規約を調べる（田中・11/13）
- [x] 前回の議事録を共有する（佐藤）

## 5. 次回

2026 年 11 月 13 日（金）10:00　第 2 会議室
`},{id:`letter`,label:`Business letter (Japanese)`,text:`---
template: letter
lang: ja
---

<p class="right">2026 年 10 月 30 日</p>

株式会社サンプル<br>
営業部　鈴木 一郎 様

<p class="right">株式会社デモ<br>
開発部　山田 太郎</p>

# 打ち合わせのお礼

拝啓　秋冷の候、貴社ますますご清栄のこととお慶び申し上げます。平素は格別のお引き立てを賜り、厚く御礼申し上げます。

先日はお忙しい中、貴重なお時間をいただき、ありがとうございました。ご説明いただいた内容を踏まえ、次の点について検討を進めてまいります。

1. 受発注画面の統合
2. 在庫情報のリアルタイム連携
3. 承認フローの電子化

つきましては、来月中旬までに概算のお見積りをお送りいたします。ご不明な点がございましたら、お気軽にご連絡ください。

今後とも、どうぞよろしくお願い申し上げます。

<p class="right">敬具</p>

---

**記**

- 見積りの送付予定：2026 年 11 月 15 日
- 連絡先：yamada@example.com
`},{id:`slides`,label:`Slides: landscape pages (Japanese)`,text:`---
title: 製品発表 2026
subtitle: 新しい PDF 変換の紹介
author: 山田 太郎
date: 2026-10-30
template: slides
---

## 今日のお話

- 何ができるのか
- どう使うのか
- これからの予定


## 何ができるのか

- **Markdown** から PDF を作る
- 図（Mermaid）と数式（KaTeX）をそのまま書ける
- 文字は選択でき、ベクターのまま出力される


## 変換の流れ

\`\`\`mermaid
flowchart LR
  A[Markdown] --> B[HTML]
  B --> C[ページ割り付け]
  C --> D[PDF]
\`\`\`


## 性能の目安

| 項目 | 結果 |
|---|---:|
| 10 ページの文書 | 約 0.8 秒 |
| 図 5 点を含む文書 | 約 1.2 秒 |
| 出力サイズ | 約 400 KB |


## これからの予定

1. テンプレートを増やす
2. 日本語の組版を磨く
3. ブラウザ上のエディタを用意する


## ありがとうございました

質問は、いつでもどうぞ。
`},{id:`invoice`,label:`Invoice (Japanese)`,text:`---
author: 株式会社デモ
stamp: 請求書番号 2026-1030
template: invoice
---

# 請 求 書

<p class="right">発行日　2026 年 10 月 30 日</p>

**株式会社サンプル　御中**

下記のとおり、ご請求申し上げます。

## 請求内容

| 品名 | 数量 | 単価 | 金額 |
|---|---:|---:|---:|
| 要件定義 | 1 | 1,200,000 | 1,200,000 |
| 開発・テスト | 1 | 4,800,000 | 4,800,000 |
| 移行支援 | 1 | 900,000 | 900,000 |
| 合計（税抜） |  |  | 6,900,000 |

## お支払い

| 項目 | 内容 |
|---|---|
| お支払い期限 | 2026 年 11 月 30 日 |
| 振込先 | サンプル銀行　本店　普通　1234567 |
| 名義 | カ）デモ |

> [!NOTE]
> 振込手数料は、お客様のご負担でお願いいたします。消費税は別途申し受けます。
`}],Rr=`markdown-playground-text`,zr=`markdown-playground-panel`,Br=()=>{let e=new URLSearchParams(window.location.search);if([...e.keys()].some(e=>e!==`mode`))return e;try{let t=localStorage.getItem(zr);if(t){let n=new URLSearchParams(t),r=e.get(`mode`);return r&&n.set(`mode`,r),n}}catch{}return e},Vr=()=>{try{return localStorage.getItem(Rr)??Lr[0].text}catch{return Lr[0].text}},Hr=`w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm`,$=`flex flex-col gap-1 text-xs font-medium text-gray-600`,Ur=({value:e,onChange:t,autoLabel:n=`From document`})=>(0,Q.jsxs)(`select`,{className:Hr,value:e,onChange:e=>t(e.target.value),children:[(0,Q.jsx)(`option`,{value:`auto`,children:n}),(0,Q.jsx)(`option`,{value:`on`,children:`On`}),(0,Q.jsx)(`option`,{value:`off`,children:`Off`})]}),Wr=()=>{let[e,t]=(0,s.useState)(Vr),[n]=(0,s.useState)(Br),[r,i]=(0,s.useState)(()=>Nr(n)),[a,o]=(0,s.useState)(()=>{let e=n.get(`tab`);return e===`diagnostics`||e===`logs`?e:`html`}),[c,l]=(0,s.useState)(()=>n.get(`view`)===`templates`?`templates`:`pdf`),[u,d]=(0,s.useState)(null),f=Ir(),p=(0,s.useMemo)(()=>Ot(),[]),m=(e,t)=>i(n=>({...n,[e]:t}));(0,s.useEffect)(()=>{r.math&&!u&&Gr().then(d)},[r.math,u]),(0,s.useEffect)(()=>{let e=new URLSearchParams(window.location.search);for(let t of[...e.keys()])t!==`mode`&&e.delete(t);for(let[t,n]of Mr(r))e.set(t,n);c===`templates`&&e.set(`view`,`templates`),a!==`html`&&e.set(`tab`,a),window.history.replaceState({},``,`${window.location.pathname}?${e.toString()}`);let t=new URLSearchParams(e);t.delete(`mode`);try{localStorage.setItem(zr,t.toString())}catch{}},[r,c,a]),(0,s.useEffect)(()=>{try{localStorage.setItem(Rr,e)}catch{}},[e]);let h=(0,s.useMemo)(()=>{if(r.math&&!u)return{pending:!0};try{return{pending:!1,doc:Tr(e,Ar(r,u??void 0))}}catch(e){return{pending:!1,error:e instanceof Error?e.message:String(e)}}},[e,r,u]),g=(0,s.useRef)(void 0);(0,s.useEffect)(()=>{if(h.pending||!(`doc`in h)||!h.doc)return;let{doc:e}=h;return clearTimeout(g.current),g.current=setTimeout(()=>{f.convert({html:e.html,width:r.width,options:{...e.renderOptions,pdfOutline:r.outline}})},500),()=>clearTimeout(g.current)},[h,r.width,r.outline]);let _=`doc`in h&&h.doc?h.doc.settings:void 0,v=`error`in h?h.error:null;return(0,Q.jsxs)(`div`,{className:`flex flex-col gap-4`,children:[(0,Q.jsxs)(`div`,{className:`grid gap-4 lg:grid-cols-2`,children:[(0,Q.jsxs)(`section`,{className:`flex min-w-0 flex-col gap-3`,children:[(0,Q.jsxs)(`div`,{className:`flex items-center justify-between gap-2`,children:[(0,Q.jsx)(`h2`,{className:`m-0 text-base font-semibold text-gray-800`,children:`Markdown`}),(0,Q.jsxs)(`select`,{className:`rounded border border-gray-300 bg-white px-2 py-1 text-sm`,value:``,onChange:e=>{let n=Lr.find(t=>t.id===e.target.value);n&&t(n.text)},children:[(0,Q.jsx)(`option`,{value:``,children:`Load a sample…`}),Lr.map(e=>(0,Q.jsx)(`option`,{value:e.id,children:e.label},e.id))]})]}),(0,Q.jsx)(`textarea`,{value:e,onChange:e=>t(e.target.value),spellCheck:!1,className:`h-80 w-full resize-y rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm leading-relaxed`}),(0,Q.jsxs)(`fieldset`,{className:`rounded-lg border border-gray-200 bg-white p-3`,children:[(0,Q.jsx)(`legend`,{className:`px-1 text-sm font-semibold text-gray-700`,children:`Look`}),(0,Q.jsxs)(`div`,{className:`grid grid-cols-2 gap-3 sm:grid-cols-3`,children:[(0,Q.jsxs)(`label`,{className:$,children:[`Template`,(0,Q.jsxs)(`select`,{className:Hr,value:r.template,onChange:e=>m(`template`,e.target.value),children:[(0,Q.jsx)(`option`,{value:``,children:`From document`}),p.map(e=>(0,Q.jsx)(`option`,{value:e.name,title:e.description,children:e.name},e.name))]})]}),(0,Q.jsxs)(`label`,{className:$,children:[`Theme`,(0,Q.jsxs)(`select`,{className:Hr,value:r.theme,onChange:e=>m(`theme`,e.target.value),children:[(0,Q.jsx)(`option`,{value:`light`,children:`Light`}),(0,Q.jsx)(`option`,{value:`dark`,children:`Dark`})]})]}),(0,Q.jsxs)(`label`,{className:$,children:[`Page size`,(0,Q.jsxs)(`select`,{className:Hr,value:r.pageSize,onChange:e=>m(`pageSize`,e.target.value),children:[(0,Q.jsx)(`option`,{value:``,children:`From template`}),Or.map(e=>(0,Q.jsx)(`option`,{value:e,children:e},e))]})]}),(0,Q.jsxs)(`label`,{className:$,children:[`Accent colour`,(0,Q.jsxs)(`div`,{className:`flex gap-1`,children:[(0,Q.jsx)(`input`,{type:`color`,className:`h-7 w-9 cursor-pointer rounded border border-gray-300 bg-white p-0.5`,value:/^#[0-9a-f]{6}$/i.test(r.accent)?r.accent:`#1d4ed8`,onChange:e=>m(`accent`,e.target.value)}),(0,Q.jsx)(`button`,{type:`button`,className:`cursor-pointer rounded border border-gray-300 bg-white px-2 text-xs text-gray-600 hover:bg-gray-50`,onClick:()=>m(`accent`,``),title:`Back to the template's colour`,children:`Reset`})]})]}),(0,Q.jsxs)(`label`,{className:$,children:[`Body font`,(0,Q.jsxs)(`select`,{className:Hr,value:r.font,onChange:e=>m(`font`,e.target.value),children:[(0,Q.jsx)(`option`,{value:``,children:`From template`}),(0,Q.jsx)(`option`,{value:`sans-serif`,children:`sans-serif`}),(0,Q.jsx)(`option`,{value:`serif`,children:`serif`})]})]}),(0,Q.jsxs)(`label`,{className:$,children:[`Stamp (every page header)`,(0,Q.jsx)(`input`,{className:Hr,value:r.stamp,placeholder:`DRAFT`,onChange:e=>m(`stamp`,e.target.value)})]}),(0,Q.jsxs)(`label`,{className:$,children:[`Cover`,(0,Q.jsx)(Ur,{value:r.cover,onChange:e=>m(`cover`,e)})]}),(0,Q.jsxs)(`label`,{className:$,children:[`Contents`,(0,Q.jsx)(Ur,{value:r.toc,onChange:e=>m(`toc`,e)})]}),(0,Q.jsxs)(`label`,{className:$,children:[`Contents depth`,(0,Q.jsx)(`input`,{type:`number`,min:1,max:6,className:Hr,value:r.tocDepth,onChange:e=>m(`tocDepth`,Math.min(6,Math.max(1,parseInt(e.target.value,10)||3)))})]})]}),(0,Q.jsxs)(`div`,{className:`mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-700`,children:[[[`outline`,`Bookmarks`],[`math`,`Maths (KaTeX)`],[`highlight`,`Code highlighting`]].map(([e,t])=>(0,Q.jsxs)(`label`,{className:`flex cursor-pointer items-center gap-1.5`,children:[(0,Q.jsx)(`input`,{type:`checkbox`,checked:r[e],onChange:t=>m(e,t.target.checked)}),t]},e)),(0,Q.jsxs)(`label`,{className:`flex items-center gap-1.5`,children:[`Width`,(0,Q.jsx)(`input`,{type:`number`,min:200,max:4e3,className:`w-20 rounded border border-gray-300 px-1 py-0.5 text-sm`,value:r.width,onChange:e=>m(`width`,Math.min(4e3,Math.max(200,parseInt(e.target.value,10)||794)))}),`px`]}),(0,Q.jsx)(`button`,{type:`button`,className:`ml-auto cursor-pointer rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50`,onClick:()=>i(Nr(new URLSearchParams)),children:`Reset all`})]}),_&&(0,Q.jsxs)(`p`,{className:`mb-0 mt-3 text-xs text-gray-500`,children:[`In effect:`,` `,[`template ${_.template??`default`}`,`cover ${_.cover?`on`:`off`}`,`contents ${_.toc===!1?`off`:`on`}`,_.page_size?`page ${_.page_size}`:null,_.accent?`accent ${_.accent}`:null].filter(Boolean).join(` · `)]})]})]}),(0,Q.jsxs)(`section`,{className:`flex min-h-[560px] min-w-0 flex-col gap-2`,children:[(0,Q.jsx)(`div`,{className:`flex gap-2 text-sm`,children:[[`pdf`,`PDF`],[`templates`,`Templates (${p.length})`]].map(([e,t])=>(0,Q.jsx)(`button`,{type:`button`,onClick:()=>l(e),className:`cursor-pointer rounded-md border px-3 py-1 ${c===e?`border-blue-600 bg-blue-50 font-semibold text-blue-700`:`border-gray-300 bg-white text-gray-600 hover:bg-gray-50`}`,children:t},e))}),c===`pdf`?(0,Q.jsx)(Er,{url:f.url,bytes:f.bytes,busy:f.busy,error:v??f.error,time:f.time,fileName:`document.pdf`}):(0,Q.jsx)(Pr,{text:e,panel:r,math:u??void 0,onPick:e=>{m(`template`,e),l(`pdf`)}})]})]}),(0,Q.jsxs)(`section`,{className:`rounded-lg border border-gray-200 bg-white`,children:[(0,Q.jsx)(`div`,{className:`flex border-b border-gray-200 text-sm`,children:[[`html`,`Generated HTML`],[`diagnostics`,`Diagnostics`],[`logs`,`Logs (${f.logs.length})`]].map(([e,t])=>(0,Q.jsx)(`button`,{type:`button`,onClick:()=>o(e),className:`cursor-pointer border-b-2 px-4 py-2 ${a===e?`border-blue-600 font-semibold text-blue-600`:`border-transparent text-gray-600 hover:text-gray-900`}`,children:t},e))}),(0,Q.jsxs)(`pre`,{className:`m-0 max-h-72 overflow-auto p-3 text-xs leading-relaxed text-gray-700`,children:[a===`html`&&(`doc`in h&&h.doc?h.doc.html:``),a===`diagnostics`&&(f.diagnostics?JSON.stringify(f.diagnostics,null,2):`No diagnostics yet.`),a===`logs`&&(f.logs.length?f.logs.map(e=>e.message).join(`
`):`No log messages.`)]})]})]})};async function Gr(){let{katexMath:e}=await o(async()=>{let{katexMath:e}=await import(`./markdown-math-CA_i6yCu.js`);return{katexMath:e}},[],import.meta.url);return e()}export{Wr as MarkdownPlayground,Wr as default};