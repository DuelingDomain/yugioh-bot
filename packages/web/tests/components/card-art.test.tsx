// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardArt } from "../../src/components/cards/card-art";

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    fill: _fill,
    onLoad,
    onError,
    className,
  }: {
    alt: string;
    src: string;
    fill?: boolean;
    onLoad?: () => void;
    onError?: () => void;
    className?: string;
  }) => (
    <img
      alt={alt}
      src={src}
      className={className}
      onLoad={onLoad}
      onError={onError}
      data-testid={`img-${src}`}
    />
  ),
}));

describe("CardArt", () => {
  it("renders the small image immediately", () => {
    render(<CardArt cardId={42} smallSrc="s.jpg" fullSrc="f.jpg" alt="Dark Magician" sizes="100px" />);
    expect(screen.getByTestId("img-/api/cards/42/image?variant=small")).toBeTruthy();
  });

  it("does not mount the full image unless loadFull is set", () => {
    render(<CardArt cardId={42} smallSrc="s.jpg" fullSrc="f.jpg" alt="DM" sizes="100px" />);
    expect(screen.queryByTestId("img-/api/cards/42/image?variant=full")).toBeNull();
  });

  it("mounts the full image hidden, then reveals it once loaded", () => {
    render(<CardArt cardId={42} smallSrc="s.jpg" fullSrc="f.jpg" alt="DM" sizes="100px" loadFull />);
    const full = screen.getByTestId("img-/api/cards/42/image?variant=full");
    expect(full.className).toContain("opacity-0");
    fireEvent.load(full);
    expect(full.className).toContain("opacity-100");
  });

  it("forwards object-fit class to the small image", () => {
    render(
      <CardArt cardId={42} smallSrc="s.jpg" fullSrc="f.jpg" alt="DM" sizes="100px" className="object-contain" />,
    );
    expect(screen.getByTestId("img-/api/cards/42/image?variant=small").className).toContain("object-contain");
  });

  it("invokes onError when an image fails to load", () => {
    const onError = vi.fn();
    render(
      <CardArt cardId={42} smallSrc="s.jpg" fullSrc="f.jpg" alt="DM" sizes="100px" onError={onError} />,
    );
    fireEvent.error(screen.getByTestId("img-/api/cards/42/image?variant=small"));
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
