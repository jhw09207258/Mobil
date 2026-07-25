import { Extension } from "@tiptap/core";

// Tiptap v2 에는 글자 크기 확장이 없다(v3 부터 제공). 이미 쓰고 있는
// textStyle 마크에 fontSize 속성을 얹어 임의 크기를 지정할 수 있게 한다 —
// H1/H2/H3 는 "문단의 의미(제목)"를 바꾸는 것이라 본문 글자만 키우고 싶을 때는
// 쓸 수 없었다. 값은 CSS 단위 문자열("18px") 그대로 저장한다.

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FontSize = Extension.create({
  name: "fontSize",

  addOptions() {
    return { types: ["textStyle"] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) =>
              attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          // 크기를 지우고 나서 빈 textStyle 마크가 남지 않게 정리한다.
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

/** 툴바 드롭다운에 노출하는 크기 목록(px). */
export const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64] as const;
