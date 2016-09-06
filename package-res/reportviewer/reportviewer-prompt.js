/*!
 * This program is free software; you can redistribute it and/or modify it under the
 * terms of the GNU Lesser General Public License, version 2.1 as published by the Free Software
 * Foundation.
 *
 * You should have received a copy of the GNU Lesser General Public License along with this
 * program; if not, you can obtain a copy at http://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
 * or from the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Lesser General Public License for more details.
 *
 * Copyright (c) 2002-2016 Pentaho Corporation..  All rights reserved.
 */

define([
  "common-ui/util/util",
  "pentaho/common/Messages",
  "dijit/registry",
  "common-ui/prompting/api/PromptingAPI",
  "common-ui/jquery-clean",
  "common-ui/underscore",
  "cdf/dashboard/Utils"
], function(util, Messages, registry, PromptingAPI, $, _, Utils) {

  var _api =  new PromptingAPI('promptPanel');

  return function() {
    return logged({
      // The current prompt mode
      mode: 'INITIAL',
      _isAsync: null,
      _pollingInterval: 1000,
      _dialogThreshold: 1500,
      _promptForLocation: null,
      _defaultOutputPath: null,
      _isReportHtmlPagebleOutputFormat : null,
      _oldParameterDefinition : null,
      _oldParameterSet : null,
      _defaultValuesMap : null,

      /**
       * Gets the prompt api instance
       *
       * @type string
       * @readonly
       */
      get api () {
        return _api;
      },

      _buildReportContentOptions: function(renderMode) {
        var options = util.getUrlParameters();
        $.extend(options, this.api.operation.getParameterValues());
        options['renderMode'] = renderMode;

        // Never send the session back. This is generated by the server.
        delete options['::session'];

        return options;
      },

      load: function() {
        Messages.addUrlBundle('reportviewer', CONTEXT_PATH+'i18n?plugin=reporting&name=reportviewer/messages/messages');
      },

      /*
       * Gets a property value from the state object in the Prompting API.
       *
       * @param prop The property which value to fetch.
       *
       * @private
       */
      _getStateProperty: function(prop) {
        return this.api.operation.state()[prop];
      },

      isParameterUpdateCall: function() {
        // never had an old definition, so we cant optimize anything.
        if (this._oldParameterDefinition == null) {
          return false;
        }
        return true;
      },

      compareParameters: function(oldParameterSet, currentParameterSet) {
        var changedParameters = [];

        $.each(oldParameterSet, function (i, parameter) {
          if (currentParameterSet.hasOwnProperty(parameter.name)) {
            if(JSON.stringify(parameter.value.toString()) !== JSON.stringify(currentParameterSet[parameter.name].toString())) {
              // add to changed
              changedParameters.push(parameter.name);
            }
          } else if("" != parameter.value) {
            // add to changed
            changedParameters.push(parameter.name);
          }
        });

        for (var parameter in currentParameterSet) {
          if (oldParameterSet && !oldParameterSet.hasOwnProperty(parameter)) {
            changedParameters.push(parameter);
          }
        }

        return changedParameters;
      },

      extractParameterValues: function(paramDefn) {
        var extractedParameters = {};
        $.each(paramDefn.parameterGroups, function (i, group) {
          var parameters = group.parameters;
          for(var i=0; i<parameters.length; i++) {
            if(parameters[i].multiSelect && parameters[i].getSelectedValuesValue().length > 0) {
              extractedParameters[parameters[i].name] = { 
                value: parameters[i].getSelectedValuesValue(),
                group: group.name,
                name: parameters[i].name
              };
            } else {
              if(parameters[i].getSelectedValuesValue().length > 0) {
                extractedParameters[parameters[i].name] = {
                  value: parameters[i].getSelectedValuesValue()[0],
                  group: group.name,
                  name: parameters[i].name
                };
              }
            }
          }
        });

        return extractedParameters;
      },

      extractDefaultValues: function(paramDefn) {
        var extractedDefaultValues = {};
        $.each(paramDefn.parameterGroups, function (i, group) {
          if("system" != group.name) {
            var parameters = group.parameters;
            for(var i=0; i<parameters.length; i++) {
              if(parameters[i].getSelectedValuesValue().length > 0) {
                extractedDefaultValues[parameters[i].name] = {
                  value: parameters[i].getSelectedValuesValue()
                };
              }
            }
          }
        });

        return extractedDefaultValues;
      },

      findChangedParameters: function() {
        var currentParameterSet = this.api.operation.getParameterValues();

        // compare currentParameterSet with oldParmaeterSet. Return an array of changed parameters. (More than one can change if we use the API).
        var changedParameters = this.compareParameters(this._oldParameterSet, currentParameterSet);
        return changedParameters;
      },

      canSkipParameterChange: function(names) {
        if(this._oldParameterSet["output-target"].value != this.api.operation.getParameterValues()["output-target"]) {
          // this has to be validated on the server.
          return false;
        }

        for(var i=0; i<names.length; i++) {
          if(this._oldParameterSet.hasOwnProperty(names[i]) && "system" == this._oldParameterSet[names[i]].group && "::session" != names[i]) {
            return false; // must be validated on the server if system parameter changed.
          }
          var param = this._oldParameterDefinition.getParameter(names[i]);
          if (param.attributes["has-downstream-dependent-parameter"] == "true") {
            return false; // must be validated on the server if at least one other parameter is dependent on this changed value.
          }
          if (param.attributes["must-validate-on-server"] == "true") {
            return false; // must be validated on the server if requested by some complex validation rules.
          }
        }
        // finally, if all params pass the test, allow to skip.
        return true;
      },

      updateParameterDefinitionWithNewValues: function(callback, names) {
        var paramDefn = $.extend(true, {}, this._oldParameterDefinition); // clone previous(old) paramDefn
        for(var i=0; i<names.length; i++) {
          /*As far as we don't recieve all parameters from server we can loose
            calculated formula results. Let's handle this case. */
          var untrusted = this.api.operation.getParameterValues()[names[i]];
          if(undefined === untrusted ){
            var p = paramDefn.getParameter(names[i]);
            if(p && p.attributes && p.attributes['must-validate-on-server']){
              untrusted = p.getSelectedValuesValue();
            }
          }
          this.api.util.validateSingleParameter(paramDefn, names[i], untrusted, this._defaultValuesMap);
        }
        try {
          this.api.util.checkParametersErrors(paramDefn); // if no errors set promptNeeded to false(show report)
          callback(undefined, paramDefn);
        } catch (e) {
          me.onFatalError(e);
        }
      },

      createPromptPanel: function() {
        this.api.operation.render(function(api, callback) {

          var paramDefnCallback = function(xml, parameterDefinition) {
            var paramDefn;
            if(!parameterDefinition) {
              // parse parameter definition from XML-response(server validation)
              paramDefn = this.parseParameterDefinition(xml);
            } else {
              // use updated parameter definition(client validation)
              paramDefn = parameterDefinition;
            }

            if(paramDefn.minimized && this._oldParameterDefinition){

              //Work with clone in order not to affect old definition
              var oldParams = $.extend(true, {}, this._oldParameterDefinition);

              //Replace all changed parameters values
              paramDefn.mapParameters( function (p) {
                oldParams.updateParameterValue(p);
              });

              //Replace root attributes
              oldParams.errors = paramDefn.errors;
              for (var key in paramDefn) {
                var prop = paramDefn[key];
                if(typeof prop == 'string' || typeof prop == 'number' || typeof prop == 'boolean' ) {
                  oldParams[key] = prop;
                }
              }
              oldParams.minimized = false;
              //Assign updated definition
              paramDefn = oldParams;
            }

            try {
              var outputFormat = paramDefn.getParameter("output-target").getSelectedValuesValue();
              this._isReportHtmlPagebleOutputFormat = outputFormat.indexOf('table/html;page-mode=page') !== -1;
            } catch (ignored) {
            }           

            // A first request is made with promptMode='INITIAL' and renderMode='PARAMETER'.
            //
            // The response will not have page count information (pagination was not performed), but simply information about the prompt parameters (paramDefn).
            //
            // When paramDefn.allowAutoSubmit() is true,
            // And no validation errors/required parameters exist to be specified, TODO: Don't think that this is being checked here!
            // In case when asynchronous mode is off - then a second request is made with promptMode='MANUAL' and renderMode='XML' is performed.
            //
            // When the response to the second request arrives,
            // Then the prompt panel is rendered, including with page count information, and  the report content is loaded and shown.
            //
            // [PIR-1163] Used 'inSchedulerDialog' variable to make sure that the second request is not sent if it's scheduler dialog.
            // Because the scheduler needs only parameters without full XML.
            if ( (typeof inSchedulerDialog === "undefined" || !inSchedulerDialog) && this.mode === 'INITIAL' && paramDefn.allowAutoSubmit() && !this._isAsync) {
              this.fetchParameterDefinition(paramDefnCallback.bind(this), 'MANUAL');
              return;
            }

            // Make sure we retain the current auto-submit setting
            //  pp.getAutoSubmitSetting -> pp.autoSubmit, which is updated by the check-box
            var autoSubmit = this._getStateProperty('autoSubmit');

            if (autoSubmit != null) {
              paramDefn.autoSubmitUI = autoSubmit;
            }

            if (this._oldParameterDefinition == null) {
              this._defaultValuesMap = this.extractDefaultValues(paramDefn);
            }
            this._oldParameterDefinition = paramDefn;
            this._oldParameterSet = this.extractParameterValues(paramDefn);

            callback(paramDefn);

            this._createPromptPanelFetchCallback(paramDefn);
            this.hideGlassPane();
          };

          var names = this.findChangedParameters();

          if (this._isAsync && this.isParameterUpdateCall()) {
            if (this.canSkipParameterChange(names)) {
              this.updateParameterDefinitionWithNewValues(paramDefnCallback.bind(this), names);
              // we did not contact the server.
              return;
            }
          }
          var needToUpdate = [];
          var oldParams = this._oldParameterDefinition;
          if(oldParams){
            oldParams.mapParameters( function (p) {
              if(names && names.indexOf(p.name) >= 0){
                //Don't need to request formulas
                if(p && (!p.attributes || (p.attributes && !p.attributes['post-processor-formula']))){
                  needToUpdate.push(p.name);
                }
              } else {
                //Request update for invalid auto-fill parameters
                if(p.attributes && oldParams.errors[p.name] && "true" === p.attributes['autofill-selection']){
                  needToUpdate.push(p.name);
                }
              }
            });
          }

          this.fetchParameterDefinition(paramDefnCallback.bind(this), this.mode, needToUpdate);
        }.bind(this));
       },

      _createPromptPanelFetchCallback: _.once(function(paramDefn) {
        this.initPromptPanel();
        this._hideLoadingIndicator();
      }),

      _hideLoadingIndicator: function() {
        try{
          if (window.top.hideLoadingIndicator) {
            window.top.hideLoadingIndicator();
          } else if (window.parent.hideLoadingIndicator) {
            window.parent.hideLoadingIndicator();
          }
        } catch (ignored) {} // Ignore "Same-origin policy" violation in embedded IFrame
      },

      initPromptPanel: function() {
        this.api.operation.init();
      },

      showGlassPane: function() {
        // Show glass pane when updating the prompt.
        registry.byId('glassPane').show();
      },

      hideGlassPane: function() {
        registry.byId('glassPane').hide();
      },

      parseParameterDefinition: function(xmlString) {
        xmlString = this.removeControlCharacters(xmlString);
        return this.api.util.parseParameterXml(xmlString);
      },

      /**
       * This method will remove illegal control characters from the text in the range of &#00; through &#31;
       * SEE:  PRD-3882 and ESR-1953
       */
      removeControlCharacters : function(inStr) {
        for (var i = 0; i <= 31; i++) {
          var safe = i;
          if (i < 10) {
            safe = '0' + i;
          }
          eval('inStr = inStr.replace(/\&#' + safe + ';/g, "")');
        }
        return inStr;
      },

      checkSessionTimeout: function(content, args) {
        if (content.status == 401 || this.isSessionTimeoutResponse(content)) {
          this.handleSessionTimeout(args);
          return true;
        }
        return false;
      },

      /**
       * @return true if the content is the login page.
       */
      isSessionTimeoutResponse: function(content) {
        if(String(content).indexOf('j_spring_security_check') != -1) {
          // looks like we have the login page returned to us
          return true;
        }
        return false;
      },

      /**
       * Prompts the user to relog in if they're within PUC, otherwise displays a dialog
       * indicating their session has expired.
       *
       * @return true if the session has timed out
       */
      handleSessionTimeout: function(args) {
        var callback = function() {
          this.fetchParameterDefinition.apply(this, args);
        }.bind(this);

        this.reauthenticate(callback);
      },

      reauthenticate: function(f) {
        var isRunningIFrameInSameOrigin = null;
        try {
          var ignoredCheckCanReachOutToParent = window.parent.mantle_initialized;
          isRunningIFrameInSameOrigin = true;
        } catch (ignoredSameOriginPolicyViolation) {
          // IFrame is running embedded in a web page in another domain
          isRunningIFrameInSameOrigin = false;
        }

        if(isRunningIFrameInSameOrigin && top.mantle_initialized) {
          var callback = {
            loginCallback : f
          }
          window.parent.authenticate(callback);
        } else {
          this.showMessageBox(
            Messages.getString('SessionExpiredComment'),
            Messages.getString('SessionExpired'),
            Messages.getString('OK'),
            undefined,
            undefined,
            undefined,
            true
          );
        }
      },

      /**
       * @private Sequence number to detect concurrent fetchParameterDefinition calls.
       * Only the response to the last call will be processed.
       */
      _fetchParamDefId: -1,

      /**
       * Loads the parameter xml definition from the server.
       * @param {function} callback function to call when successful.
       * The callback signature is:
       * <pre>void function(xmlString)</pre>
       *  and is called in the context of the report viewer prompt instance.
       * @param {string} [promptMode='MANUAL'] the prompt mode to request from server:
       *  x INITIAL   - first time
       *  x MANUAL    - user pressed the submit button (or, when autosubmit, after INITIAL fetch)
       *  x USERINPUT - due to a change + auto-submit
       *
       * If not provided, 'MANUAL' will be used.
       * @param changedParams - list of changed parameters names
       */
      fetchParameterDefinition: function(callback, promptMode, changedParams ) {
        var me = this;

        var fetchParamDefId = ++me._fetchParamDefId;

        me.showGlassPane();

        if (!promptMode) {
          promptMode = 'MANUAL';
        } else if (promptMode == 'USERINPUT') {
          // Hide glass pane to prevent user from being blocked from changing his selection
          me.hideGlassPane();
        }

        var curUrl = window.location.href.split('?')[0];
        if (this._isAsync === null) {
          var asyncConf = pentahoGet(curUrl.substring(0, curUrl.indexOf("/api/repos")) + '/plugin/reporting/api/jobs/config', "");
          if (asyncConf) {
            try {
              asyncConf = JSON.parse(asyncConf);
              this._isAsync = asyncConf.supportAsync;
              this._pollingInterval = asyncConf.pollingIntervalMilliseconds;
              this._dialogThreshold = asyncConf.dialogThresholdMilliseconds;
              this._promptForLocation = asyncConf.promptForLocation;
              this._defaultOutputPath = asyncConf.defaultOutputPath;
            } catch (ignored){
              //not async
            }
          }
        }

        // Store mode so we can check if we need to refresh the report content or not in the view
        // As only the last request's response is processed, the last value of mode is actually the correct one.
        me.mode = promptMode;

        var options = me._buildReportContentOptions(this._getParameterDefinitionRenderMode(promptMode));

        var args = arguments;

        var onSuccess = logged('fetchParameterDefinition_success', function(xmlString) {
          if (me.checkSessionTimeout(xmlString, args)) { return; }

          // Another request was made after this one, so this one is ignored.
          if (fetchParamDefId !== me._fetchParamDefId) { return; }

          try {
            callback(xmlString);
          } catch (e) {
            me.onFatalError(e);
          } finally {
            me.mode = 'USERINPUT';
          }
        });

        var onError = function(e) {
          if (!me.checkSessionTimeout(e, args)) {
            me.onFatalError(e);
          }
        };

        if(changedParams){
          options['changedParameters'] = changedParams;
        }

        $.ajax({
          async:   true,
          traditional: true, // Controls internal use of $.param() to serialize data to the url/body.
          cache:   false,
          type:    'POST',
          url:     me.getParameterUrl(),
          data:    options,
          dataType:'text',
          success: onSuccess,
          error:   onError
        });
      },

      _getParameterDefinitionRenderMode: function(promptMode) {
        switch(promptMode) {
          case 'INITIAL':
              return 'PARAMETER';

          case 'USERINPUT':
            if (!this._getStateProperty('autoSubmit') || this._isAsync) {
              return 'PARAMETER';
            }
            break;

          case 'MANUAL':
            if (this._isAsync) {
              return 'PARAMETER';
            }
            break;
        }

        return 'XML';
      },

      getParameterUrl: function() {
        return 'parameter';
      },

      showMessageBox: function( message, dialogTitle, button1Text, button1Callback, button2Text, button2Callback, blocker ) {
        var messageBox = registry.byId('messageBox');

        messageBox.setTitle('<div class="pentaho-reportviewer-errordialogtitle">' + Utils.escapeHtml(dialogTitle) + '</div>');
        messageBox.setMessage('<div class="pentaho-reportviewer-errordialogmessage">' + Utils.escapeHtml(message) + '</div>');

        if (blocker) {
          messageBox.setButtons([]);
        } else {
          var closeFunc = (function() {
            if(!this._isAsync) {
              this.api.ui.hideProgressIndicator();
            } else {
              this.hideGlassPane();
            }
            messageBox.hide.call(messageBox);
          }).bind(this);

          if(!button1Text) {
            button1Text = Messages.getString('OK');
          }
          if(!button1Callback) {
            button1Callback = closeFunc;
          }

          messageBox.onCancel = closeFunc;

          if(button2Text) {
            messageBox.callbacks = [
              button1Callback,
              button2Callback
            ];
            messageBox.setButtons([button1Text,button2Text]);
          } else {
            messageBox.callbacks = [
              button1Callback
            ];
            messageBox.setButtons([button1Text]);
          }
        }

        if(!this._isAsync) {
          this.api.ui.showProgressIndicator();
        }
        messageBox.show();
      },

      /**
       * Called when there is a fatal error during parameter definition fetching/parsing
       *
       * @param e Error/exception encountered
       */
      onFatalError: function(e) {
        var errorMsg = Messages.getString('ErrorParsingParamXmlMessage');
        if (typeof console !== 'undefined' && console.log) {
          console.log(errorMsg + ": " + e);
        }
        this.showMessageBox(
          errorMsg,
          Messages.getString('FatalErrorTitle'));
      }
    }); // return logged
  }; // return function
});
