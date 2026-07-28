# Closer Journey — Site

Site institucional da mentoria **Closer Journey**, de Cris Rangel.

## Estrutura

```
.
├── index.html          # página principal
├── depoimentos.html    # feed de depoimentos (estilo Instagram)
├── styles.css           # estilos e tokens de marca (cores, tipografia)
└── assets/               # logos, fotos e depoimentos (imagens)
```

## Rodar localmente

Não precisa de build nem de instalação — é HTML/CSS puro.

Abra `index.html` direto no navegador, ou sirva a pasta com um servidor simples:

```bash
python3 -m http.server 8000
# depois acesse http://localhost:8000
```

## Publicar no GitHub Pages

1. Vá em **Settings → Pages** no repositório.
2. Em **Source**, selecione a branch `main` e a pasta `/ (root)`.
3. Salve. Em alguns minutos o site fica disponível em:
   `https://<seu-usuario>.github.io/<nome-do-repositorio>/`

## Identidade visual

- Cores: `#4F0C22` (deep), `#7A2340` (mid), `#C72F51` (rose), `#E4DCD6` (cream)
- Tipografia: Playfair Display (títulos) + Jost (corpo/labels)
- Todos os tokens estão centralizados em `styles.css`, no bloco `:root`.
