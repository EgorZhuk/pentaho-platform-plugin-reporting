package org.pentaho.reporting.platform.plugin.output;

import java.io.IOException;
import java.io.OutputStream;

import org.pentaho.reporting.engine.classic.core.MasterReport;
import org.pentaho.reporting.engine.classic.core.ReportProcessingException;
import org.pentaho.reporting.engine.classic.core.layout.output.YieldReportListener;
import org.pentaho.reporting.engine.classic.core.modules.output.pageable.base.PageableReportProcessor;
import org.pentaho.reporting.engine.classic.core.modules.output.pageable.pdf.PdfOutputProcessor;
import org.pentaho.reporting.engine.classic.core.util.NullOutputStream;

public class PDFOutput
{
  private static PageableReportProcessor createProcessor(final MasterReport report,
                                                    final int yieldRate,
                                                    final OutputStream outputStream) throws ReportProcessingException
    {
      final PdfOutputProcessor outputProcessor = new PdfOutputProcessor(report.getConfiguration(), outputStream);
      final PageableReportProcessor proc = new PageableReportProcessor(report, outputProcessor);
      if (yieldRate > 0)
      {
        proc.addReportProgressListener(new YieldReportListener(yieldRate));
      }
      return proc;
  }

  public static int paginate(final MasterReport report,
                                 final int yieldRate) throws ReportProcessingException, IOException
  {
    PageableReportProcessor proc = null;
    try
    {
      final PdfOutputProcessor outputProcessor = new PdfOutputProcessor(report.getConfiguration(), new NullOutputStream());
      proc = new PageableReportProcessor(report, outputProcessor);
      if (yieldRate > 0)
      {
        proc.addReportProgressListener(new YieldReportListener(yieldRate));
      }
      proc.paginate();
      return proc.getPhysicalPageCount();
    }
    finally
    {
      if (proc != null)
      {
        proc.close();
      }
    }
  }

    public static boolean generate(final MasterReport report,
                          final OutputStream outputStream,
                          final int yieldRate) throws ReportProcessingException, IOException
    {
        final PageableReportProcessor proc = createProcessor(report, yieldRate, outputStream);
        try
        {
          proc.processReport();
          return true;
        }
        finally
        {
          proc.close();
        }
    }
}
