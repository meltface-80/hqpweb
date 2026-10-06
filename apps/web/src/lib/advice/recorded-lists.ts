// Lists as HQPlayer reports them, for the advice tests (read-only captures; see
// packages/fake-hqp/profiles). Desktop 5.35 in SDM and PCM mode; 6.1 is 5.35 with the
// 5L AHM removed and the 4B AHM added, per the 6.1 release notes (not yet seen live).
export const MODULATORS_V5 = [
  ...["DSD5", "DSD5v2", "DSD5v2 256+fs", "DSD5EC", "ASDM5", "ASDM5EC", "ASDM5ECv2", "ASDM5ECv3"],
  ...["ASDM5EC-ul", "ASDM5EC-light", "ASDM5EC-fast", "ASDM5EC-super"],
  ...["ASDM5EC-ul 512+fs", "ASDM5EC-light 512+fs", "ASDM5EC-fast 512+fs", "ASDM5EC-super 512+fs"],
  ...["DSD7", "DSD7 256+fs", "ASDM7", "ASDM7EC", "ASDM7ECv2", "ASDM7ECv3"],
  ...["ASDM7EC-ul", "ASDM7EC-light", "ASDM7EC-fast", "ASDM7EC-super"],
  ...["ASDM7EC-ul 512+fs", "ASDM7EC-light 512+fs", "ASDM7EC-fast 512+fs", "ASDM7EC-super 512+fs"],
  ...["AMSDM7 512+fs", "AMSDM7EC 512+fs", "AHM5EC5L", "AHM7EC5L", "AHM5EC8B", "AHM7EC8B"],
];
export const MODULATORS_V61 = [...MODULATORS_V5.filter((n) => !n.endsWith("5L")), "AHM5EC4B", "AHM7EC4B"];
export const SHAPERS_V5 = ["none", "NS1", "NS4", "NS5", "NS9", "LNS15", "RPDF", "TPDF", "Gauss1", "shaped"];
