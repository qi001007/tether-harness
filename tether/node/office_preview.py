from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import psutil


class OfficePreviewError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _soffice_executable() -> str | None:
    configured = os.environ.get("TETHER_SOFFICE_EXE")
    if configured:
        return configured if Path(configured).is_file() else None
    names = ("soffice.com", "soffice", "libreoffice") if os.name == "nt" else ("soffice", "libreoffice")
    for name in names:
        found = shutil.which(name)
        if found:
            return found

    candidates: list[Path] = []
    if os.name == "nt":
        for key in ("PROGRAMFILES", "PROGRAMFILES(X86)"):
            root = os.environ.get(key)
            if root:
                candidates.extend((Path(root) / "LibreOffice" / "program" / "soffice.com",
                                   Path(root) / "LibreOffice" / "program" / "soffice.exe"))
    elif sys.platform == "darwin":
        candidates.append(Path("/Applications/LibreOffice.app/Contents/MacOS/soffice"))

    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def _process_identity(pid: int) -> dict[str, Any] | None:
    try:
        process = psutil.Process(pid)
        return {"pid": pid, "create_time": process.create_time(), "exe": process.exe()}
    except (psutil.Error, OSError):
        return None


def _matching_process(identity: dict[str, Any]) -> Any | None:
    try:
        process = psutil.Process(int(identity["pid"]))
        if process.create_time() != identity["create_time"]:
            return None
        if identity.get("exe") and process.exe() != identity["exe"]:
            return None
        return process
    except (psutil.Error, OSError, KeyError, TypeError, ValueError):
        return None


def _remember_children(pid: int, owned: dict[int, dict[str, Any]]) -> None:
    try:
        for child in psutil.Process(pid).children(recursive=True):
            identity = _process_identity(child.pid)
            if identity:
                owned[child.pid] = identity
    except (psutil.Error, OSError):
        pass


def _stop_owned_processes(identities: list[dict[str, Any]]) -> None:
    processes = [process for item in identities if (process := _matching_process(item)) is not None]
    for process in processes:
        try:
            process.terminate()
        except psutil.Error:
            pass
    _, alive = psutil.wait_procs(processes, timeout=3)
    for process in alive:
        identity = next((item for item in identities if item["pid"] == process.pid), None)
        if identity and _matching_process(identity):
            try:
                process.kill()
            except psutil.Error:
                pass
    if alive:
        psutil.wait_procs(alive, timeout=3)


def _cleanup_workdir(work: Path) -> None:
    for attempt in range(6):
        try:
            shutil.rmtree(work)
            return
        except FileNotFoundError:
            return
        except OSError:
            if attempt == 5:
                return
            time.sleep(0.25)


def office_pdf(source: Path, kind: str) -> bytes:
    """Convert a Word or PowerPoint document to PDF with an isolated LO profile."""
    filters = {"word": "writer_pdf_Export", "powerpoint": "impress_pdf_Export"}
    export_filter = filters.get(kind)
    if not export_filter:
        raise OfficePreviewError("office_convert_failed", "Unsupported Office document type.")

    executable = _soffice_executable()
    if not executable:
        raise OfficePreviewError(
            "office_missing",
            "LibreOffice is unavailable. Install it from https://www.libreoffice.org/download/.",
        )

    try:
        original = Path(source).resolve(strict=True)
        if not original.is_file():
            raise OSError("not a regular file")
    except (OSError, RuntimeError, TypeError, ValueError):
        raise OfficePreviewError("office_convert_failed", "The Office source file is unavailable.") from None

    work = Path(tempfile.mkdtemp(prefix="tether-office-preview-"))
    process: subprocess.Popen | None = None
    owned_children: dict[int, dict[str, Any]] = {}
    try:
        input_dir = work / "input"
        output_dir = work / "output"
        profile_dir = work / "profile"
        input_dir.mkdir()
        output_dir.mkdir()
        profile_dir.mkdir()
        staged_source = input_dir / original.name
        output_pdf = output_dir / (original.stem + ".pdf")
        try:
            shutil.copyfile(original, staged_source)
        except OSError:
            raise OfficePreviewError("office_convert_failed", "The Office source file could not be staged.") from None

        argv = [
            executable,
            "--headless",
            "--norestore",
            "--nodefault",
            "--nolockcheck",
            "-env:UserInstallation=" + profile_dir.as_uri(),
            "--convert-to",
            "pdf:" + export_filter,
            "--outdir",
            str(output_dir),
            str(staged_source),
        ]
        try:
            with (work / "conversion.log").open("wb") as log:
                process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log,
                                           stderr=subprocess.STDOUT, shell=False,
                                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                deadline = time.monotonic() + 45
                while process.poll() is None:
                    _remember_children(process.pid, owned_children)
                    if time.monotonic() >= deadline:
                        root = _process_identity(process.pid)
                        _stop_owned_processes(list(owned_children.values()) + ([root] if root else []))
                        raise OfficePreviewError("office_timeout", "LibreOffice PDF conversion timed out after 45 seconds.")
                    time.sleep(0.05)
                returncode = process.returncode
            _remember_children(process.pid, owned_children)
        except OfficePreviewError:
            raise
        except OSError:
            raise OfficePreviewError("office_missing", "LibreOffice could not be started.") from None

        if returncode != 0:
            raise OfficePreviewError("office_convert_failed", "LibreOffice could not convert this Office document.")
        if not output_pdf.is_file():
            raise OfficePreviewError("office_output_missing", "LibreOffice did not create a PDF preview.")
        try:
            data = output_pdf.read_bytes()
        except OSError:
            raise OfficePreviewError("office_output_missing", "The generated PDF preview could not be read.") from None
        if not data.startswith(b"%PDF-"):
            raise OfficePreviewError("office_convert_failed", "LibreOffice returned an invalid PDF preview.")
        return data
    finally:
        if process is not None:
            _remember_children(process.pid, owned_children)
        _stop_owned_processes(list(owned_children.values()))
        _cleanup_workdir(work)
