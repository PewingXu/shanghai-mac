export default function PageBackground() {
  return (
    <>
      {/* 背景渐变层 */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background:
            "linear-gradient(145deg, #E8A050 0%, #EDB870 15%, #F2C880 30%, #F7D89A 55%, #FAEAB8 75%, #FDF5D8 100%)",
          zIndex: 0,
        }}
      />
      {/* 右上角装饰光晕 */}
      <div
        style={{
          position: "fixed",
          top: "-180px",
          right: "-180px",
          width: "680px",
          height: "680px",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,230,170,0.55) 0%, rgba(255,210,130,0.25) 45%, transparent 70%)",
          zIndex: 1,
          pointerEvents: "none",
        }}
      />
      {/* 左下角装饰光晕 */}
      <div
        style={{
          position: "fixed",
          bottom: "-220px",
          left: "-180px",
          width: "660px",
          height: "660px",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,230,170,0.45) 0%, rgba(255,210,130,0.2) 45%, transparent 70%)",
          zIndex: 1,
          pointerEvents: "none",
        }}
      />
    </>
  );
}
