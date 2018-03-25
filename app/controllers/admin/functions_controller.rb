module Admin
  class FunctionsController < ApplicationController
    def index; end

    def create
      function = Function.create(function_params)

      unless function.persisted?
        flash[:error] = function.errors.full_messages.to_sentence
      end

      redirect_to admin_functions_path
    end

    def edit
      @function = Function.find(params[:id])
    end

    def update
      function = Function.find(params[:id])

      unless function.update(function_params)
        flash[:error] = function.errors.full_messages.to_sentence
      end

      redirect_to admin_functions_path
    end

    def destroy
      function = Function.find(params[:id])

      unless function.destroy
        flash[:error] = function.errors.full_messages.to_sentence
      end

      redirect_to admin_functions_path
    end

  private

    def function_params
      params.require(:function).permit(:name)
    end
  end
end
