import { ResumeWorkspace } from "../components/ResumeWorkspace";
import { t } from "../lib/i18n";

export default function Resume() {
  return (
    <>
      <header className="top no-print">
        <div><h1>{t("Resume Builder")}</h1>
          <div className="sub">{t("Build one master resume, get it approved, then tailor a version for each job with a free AI chat.")}</div></div>
      </header>
      <div className="content"><ResumeWorkspace studentId="me" /></div>
    </>);
}
