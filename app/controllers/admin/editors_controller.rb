module Admin
  class EditorsController < AdminControllerBase
    def index; end

    def create
      editor = Editor.create(editor_params)

      unless editor.persisted?
        flash[:error] = editor.errors.full_messages.to_sentence
      end

      redirect_to admin_editors_path
    end

    def edit
      @editor = Editor.find(params[:id])
    end

    def update
      editor = Editor.find(params[:id])

      unless editor.update(editor_params)
        flash[:error] = editor.errors.full_messages.to_sentence
      end

      redirect_to admin_editors_path
    end

    def destroy
      editor = Editor.find(params[:id])

      unless editor.destroy
        flash[:error] = editor.errors.full_messages.to_sentence
      end

      redirect_to admin_editors_path
    end

  private

    def editor_params
      params.require(:editor).permit(:name)
    end
  end
end
