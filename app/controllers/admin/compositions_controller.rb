class Admin::CompositionsController < Admin::AdminControllerBase
  def index
    respond_to do |format|
      format.html {
        @title = Title.find_by(id: params[:title_id])
        @compositions = (@title.present? ? @title.compositions : Composition.none)
      }

      format.json {
        titles = Title.search(params[:q])
        compositions = Composition
          .where(title_id: titles.select(:id))
          .left_outer_joins(:title, :composers, :composition_type)
          .order("titles.text, composers.name, composition_types.name")

        render json: {
          results: compositions.map { |c| { id: c.id, text: c.text } },
          pagination: {
            more: false,
          }
        }
      }
    end
  end

  def show
    @composition = Composition.find(params[:id])
  end

  def new
    @composition = Composition.new
  end

  def create
    return_to = params[:return_to]

    unless (composition = Composition.new(composition_params)).save
      flash[:error] = composition.errors.full_messages.to_sentence
      return_to.gsub!("false", "true")
    end

    redirect_to return_to || admin_compositions_path(title_id: composition.title_id)
  end

  def edit
    @composition = Composition.find(params[:id])
  end

  def update
    composition = Composition.find(params[:id])

    composition.assign_attributes(composition_params)

    if composition.save
      redirect_to admin_compositions_path(title_id: composition.title_id)
    else
      render :edit
    end
  end

  def confirm_delete
    @composition = Composition.find(params[:id])
  end

  def destroy
    composition = Composition.find(params[:id])
    composition.destroy!

    redirect_to admin_compositions_path(title_id: composition.title_id)
  end

  private

  def composition_params
    params.require(:composition).permit(
      :composition_type_id,
      :even_odd,
      :number_of_voices,
      :title_id,
      :tone,
      composer_ids: [],
    )
  end
end
